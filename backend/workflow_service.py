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
        for root, _, files in os.walk(self.workflows_dir):
            if filename in files:
                return os.path.join(root, filename)
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

        # 1. Update UI JSON widgets first (positional)
        for param_key, param_value in user_params.items():
            if param_key in mapping["inputs"]:
                input_info = mapping["inputs"][param_key]
                node_id = str(input_info["node_id"])
                w_idx = input_info.get("widget_index")
                
                for node in workflow.get("nodes", []):
                    if str(node["id"]) == node_id:
                        if "widgets_values" in node and w_idx is not None:
                            if w_idx < len(node["widgets_values"]):
                                node["widgets_values"][w_idx] = param_value
                        break
        
        # 2. Convert to final API format for ComfyUI
        if not self.is_api_format(workflow):
            workflow = self.convert_ui_to_api(workflow)
            
        return workflow

workflow_service = WorkflowService(workflows_dir="h:/Feddafront-050426/1-WORKFLOWS")
