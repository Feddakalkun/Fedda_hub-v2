import json
import os
import uuid
from typing import Any, Dict, Optional

class WorkflowService:
    def __init__(self, workflows_dir: str):
        self.workflows_dir = workflows_dir
        self.mapping_file = os.path.join(os.path.dirname(__file__), "..", "config", "workflow_api.json")

    def load_mapping(self) -> Dict[str, Any]:
        if not os.path.exists(self.mapping_file):
            return {}
        with open(self.mapping_file, "r") as f:
            return json.load(f)

    def get_workflow_path(self, filename: str) -> str:
        # 1. Try direct path from workflows_dir
        direct_path = os.path.join(self.workflows_dir, filename)
        if os.path.exists(direct_path):
            return direct_path
        
        # 2. Recursive search for just the basename if direct fails
        basename = os.path.basename(filename)
        for root, _, files in os.walk(self.workflows_dir):
            if basename in files:
                return os.path.join(root, basename)
        return ""

    def is_api_format(self, data: dict) -> bool:
        if 'nodes' in data or 'links' in data:
            return False
        for v in data.values():
            if isinstance(v, dict) and 'class_type' in v:
                return True
        return False

    def convert_ui_to_api(self, data: dict) -> dict:
        """
        Robust ComfyUI GUI → API format converter.
        Ported from dev_tools/convert_workflows.py
        """
        links = {}
        for l in data.get('links', []):
            links[l[0]] = l

        api = {}
        for node in data.get('nodes', []):
            node_id = str(node['id'])
            class_type = node.get('type', 'Unknown')
            node_inputs = node.get('inputs', []) or []
            widget_values = list(node.get('widgets_values', []) or [])
            
            resolved = {}
            widget_idx = 0

            for inp in node_inputs:
                name = inp.get('name', '')
                link_id = inp.get('link')
                is_widget = 'widget' in inp

                if link_id is not None:
                    lnk = links.get(link_id)
                    if lnk:
                        resolved[name] = [str(lnk[1]), lnk[2]]
                elif is_widget:
                    if widget_idx < len(widget_values):
                        resolved[name] = widget_values[widget_idx]
                        widget_idx += 1
                else:
                    if widget_idx < len(widget_values):
                        resolved[name] = widget_values[widget_idx]
                        widget_idx += 1

            if not node_inputs and widget_values:
                for i, v in enumerate(widget_values):
                    resolved[f'_widget_{i}'] = v

            api[node_id] = {
                'inputs': resolved,
                'class_type': class_type
            }
        return api

    def prepare_payload(self, workflow_id: str, user_params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Loads workflow, injects params into UI structure, then converts to API structure.
        """
        mappings = self.load_mapping()
        if workflow_id not in mappings:
            return None

        mapping = mappings[workflow_id]
        path = self.get_workflow_path(mapping.get("filename"))
        if not path or not os.path.exists(path):
            return None

        with open(path, "r", encoding="utf-8") as f:
            workflow = json.load(f)

        # 1. Inject parameters
        is_api = self.is_api_format(workflow)
        print(f"[WorkflowService] Preparing payload. is_api={is_api}")

        for param_key, param_value in user_params.items():
            if param_key in mapping["inputs"]:
                input_info = mapping["inputs"][param_key]
                node_id = str(input_info["node_id"])
                
                print(f"  > Injecting '{param_key}' -> Node {node_id} (value: {param_value})")

                if input_info.get("type") == "loras" and isinstance(param_value, list):
                    # Dynamic LoRA chain: replace the placeholder node with a chain of
                    # LoraLoader / LoraLoaderModelOnly nodes, then rewire downstream refs.
                    if node_id not in workflow:
                        print(f"  [WARN] LoRA placeholder node {node_id} not found")
                        continue

                    placeholder   = workflow[node_id]
                    model_source  = placeholder["inputs"].get("model", ["16", 0])
                    clip_source   = placeholder["inputs"].get("clip")          # None for ModelOnly
                    model_only    = clip_source is None

                    del workflow[node_id]

                    active_loras = [l for l in param_value if l.get("name")]

                    if not active_loras:
                        # No LoRAs — bypass: rewire all downstream refs to upstream sources
                        for nid, node in workflow.items():
                            for key, val in list(node.get("inputs", {}).items()):
                                if isinstance(val, list) and len(val) == 2 and str(val[0]) == node_id:
                                    node["inputs"][key] = model_source if val[1] == 0 else (clip_source or ["18", 0])
                    else:
                        curr_model = model_source
                        curr_clip  = clip_source
                        last_id    = None

                        for i, lora_data in enumerate(active_loras[:5]):
                            lid = f"_lora_{i}"
                            if model_only:
                                workflow[lid] = {
                                    "inputs": {
                                        "lora_name":      lora_data["name"],
                                        "strength_model": float(lora_data.get("strength", 1.0)),
                                        "model":          curr_model,
                                    },
                                    "class_type": "LoraLoaderModelOnly",
                                }
                            else:
                                workflow[lid] = {
                                    "inputs": {
                                        "lora_name":      lora_data["name"],
                                        "strength_model": float(lora_data.get("strength", 1.0)),
                                        "strength_clip":  float(lora_data.get("strength", 1.0)),
                                        "model":          curr_model,
                                        "clip":           curr_clip,
                                    },
                                    "class_type": "LoraLoader",
                                }
                                curr_clip = [lid, 1]
                            curr_model = [lid, 0]
                            last_id    = lid

                        # Rewire every downstream ref that pointed at the old placeholder
                        for nid, node in workflow.items():
                            if nid.startswith("_lora_"):
                                continue
                            for key, val in list(node.get("inputs", {}).items()):
                                if isinstance(val, list) and len(val) == 2 and str(val[0]) == node_id:
                                    node["inputs"][key] = [last_id, val[1]]

                        print(f"  [OK] Injected {len(active_loras)} LoRA(s): {[l['name'] for l in active_loras]}")
                    continue

                if is_api:
                    # API Format Injection
                    input_key = input_info.get("input_key") or param_key
                    if node_id in workflow:
                        if "inputs" not in workflow[node_id]:
                            workflow[node_id]["inputs"] = {}
                        workflow[node_id]["inputs"][input_key] = param_value
                    else:
                        print(f"    [WARN] Node {node_id} NOT FOUND in workflow!")
                else:
                    # UI Format Injection
                    w_idx = input_info.get("widget_index")
                    found = False
                    for node in workflow.get("nodes", []):
                        if str(node["id"]) == node_id:
                            found = True
                            if "widgets_values" in node and w_idx is not None:
                                if w_idx < len(node["widgets_values"]):
                                    node["widgets_values"][w_idx] = param_value
                                    print(f"    [OK] Updated widget[{w_idx}]")
                            break
                    if not found:
                        print(f"    [WARN] Node {node_id} NOT FOUND in UI nodes!")
        
        # 2. Convert to final API format for ComfyUI if needed
        if not is_api:
            workflow = self.convert_ui_to_api(workflow)
            
        return workflow

# Initialize service with dynamic path relative to this file
script_dir = os.path.dirname(os.path.abspath(__file__))
default_workflows = os.path.join(script_dir, "workflows")
workflow_service = WorkflowService(workflows_dir=default_workflows)
