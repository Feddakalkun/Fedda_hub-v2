#!/usr/bin/env python3
"""
FEDDA AI Studio — RunPod One-Click Deployer

Usage:
    python deploy.py                    # Interactive GPU picker
    python deploy.py --gpu "RTX 4090"   # Direct GPU selection
    python deploy.py --list             # List available GPUs
    python deploy.py --stop <pod_id>    # Stop a running pod
    python deploy.py --terminate <id>   # Terminate (delete) a pod

Requires: RUNPOD_API_KEY environment variable (or prompts for it)
"""

import os
import sys
import json
import argparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ─── Configuration ───────────────────────────────────────────────────
DOCKER_IMAGE = "ghcr.io/feddakalkun/comfyuifeddafront:latest"
POD_NAME = "FEDDA AI Studio"
VOLUME_GB = 75          # Network volume for models + outputs
CONTAINER_DISK_GB = 30  # Container disk for OS + packages
MIN_VCPU = 4
MIN_MEMORY_GB = 16
PORTS = "3000/http,8199/http,8888/http,22/tcp"
VOLUME_MOUNT = "/workspace"

# Popular GPU choices for video generation
GPU_PRESETS = {
    "1": ("NVIDIA RTX A6000",       "48 GB — Great all-rounder"),
    "2": ("NVIDIA RTX 4090",        "24 GB — Fast, good for LTX-2"),
    "3": ("NVIDIA A100 80GB PCIe",  "80 GB — Premium, large models"),
    "4": ("NVIDIA A100-SXM4-80GB",  "80 GB — Fastest A100"),
    "5": ("NVIDIA RTX A5000",       "24 GB — Budget option"),
    "6": ("NVIDIA L40S",            "48 GB — Ada Lovelace"),
    "7": ("NVIDIA RTX 4080",        "16 GB — Entry level"),
    "8": ("NVIDIA H100 80GB HBM3",  "80 GB — Top tier"),
}

API_URL = "https://api.runpod.io/graphql"


def get_api_key():
    """Get RunPod API key from env or prompt."""
    key = os.environ.get("RUNPOD_API_KEY", "").strip()
    if not key:
        print("\n  No RUNPOD_API_KEY found in environment.")
        print("  Get yours at: https://www.runpod.io/console/user/settings\n")
        key = input("  Enter your RunPod API key: ").strip()
        if not key:
            print("  ERROR: API key is required.")
            sys.exit(1)
    return key


def graphql(api_key: str, query: str, variables: dict = None) -> dict:
    """Execute a GraphQL query against RunPod API."""
    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    req = Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"\n  API Error {e.code}: {body}")
        sys.exit(1)

    if "errors" in result:
        for err in result["errors"]:
            print(f"\n  GraphQL Error: {err.get('message', err)}")
        sys.exit(1)

    return result.get("data", {})


def list_gpus(api_key: str):
    """List available GPU types on RunPod."""
    query = """
    query {
        gpuTypes {
            id
            displayName
            memoryInGb
            maxGpuCount
        }
    }
    """
    data = graphql(api_key, query)
    gpus = data.get("gpuTypes", [])
    gpus.sort(key=lambda g: g.get("memoryInGb", 0), reverse=True)

    print(f"\n  {'GPU Type':<40} {'VRAM':<10} {'ID'}")
    print(f"  {'─' * 40} {'─' * 10} {'─' * 30}")
    for g in gpus:
        name = g.get("displayName", g.get("id", "?"))
        mem = g.get("memoryInGb", "?")
        gid = g.get("id", "?")
        print(f"  {name:<40} {mem} GB     {gid}")
    print()


def list_pods(api_key: str):
    """List current pods."""
    query = """
    query {
        myself {
            pods {
                id
                name
                desiredStatus
                runtime {
                    uptimeInSeconds
                    ports {
                        ip
                        isIpPublic
                        privatePort
                        publicPort
                        type
                    }
                    gpus {
                        id
                        gpuUtilPercent
                        memoryUtilPercent
                    }
                }
                machine {
                    podHostId
                }
                imageName
                gpuCount
            }
        }
    }
    """
    data = graphql(api_key, query)
    pods = data.get("myself", {}).get("pods", [])

    if not pods:
        print("\n  No pods running.\n")
        return

    print(f"\n  {'ID':<28} {'Name':<25} {'Status':<12} {'Image'}")
    print(f"  {'─' * 28} {'─' * 25} {'─' * 12} {'─' * 40}")
    for p in pods:
        print(f"  {p['id']:<28} {p.get('name', '?'):<25} {p.get('desiredStatus', '?'):<12} {p.get('imageName', '?')}")

        # Show ports/URLs
        runtime = p.get("runtime")
        if runtime and runtime.get("ports"):
            for port in runtime["ports"]:
                if port.get("isIpPublic") and port.get("publicPort"):
                    proto = "https" if port["type"] == "http" else port["type"]
                    print(f"           Port {port['privatePort']}: {proto}://{port['ip']}:{port['publicPort']}")
    print()


def deploy_pod(api_key: str, gpu_type_id: str):
    """Deploy a new pod on RunPod."""
    query = """
    mutation($input: PodFindAndDeployOnDemandInput!) {
        podFindAndDeployOnDemand(input: $input) {
            id
            name
            desiredStatus
            imageName
            machineId
            costPerHr
        }
    }
    """
    variables = {
        "input": {
            "name": POD_NAME,
            "imageName": DOCKER_IMAGE,
            "gpuTypeId": gpu_type_id,
            "cloudType": "ALL",
            "volumeInGb": VOLUME_GB,
            "containerDiskInGb": CONTAINER_DISK_GB,
            "minVcpuCount": MIN_VCPU,
            "minMemoryInGb": MIN_MEMORY_GB,
            "ports": PORTS,
            "volumeMountPath": VOLUME_MOUNT,
            "startJupyter": False,  # We run our own JupyterLab
            "startSsh": True,
            "dockerArgs": "",
            "env": [],
        }
    }

    print(f"\n  Deploying {POD_NAME}...")
    print(f"  Image:  {DOCKER_IMAGE}")
    print(f"  GPU:    {gpu_type_id}")
    print(f"  Volume: {VOLUME_GB} GB → {VOLUME_MOUNT}")
    print(f"  Ports:  {PORTS}")
    print()

    data = graphql(api_key, query, variables)
    pod = data.get("podFindAndDeployOnDemand", {})

    if not pod or not pod.get("id"):
        print("  ERROR: Failed to deploy pod. Check GPU availability.")
        sys.exit(1)

    pod_id = pod["id"]
    cost = pod.get("costPerHr", "?")

    print(f"  Pod deployed successfully!")
    print(f"  ─────────────────────────────────────────")
    print(f"  Pod ID:    {pod_id}")
    print(f"  Cost:      ${cost}/hr")
    print(f"  Status:    {pod.get('desiredStatus', 'RUNNING')}")
    print()
    print(f"  Your URLs (wait ~2-3 min for services to start):")
    print(f"  ─────────────────────────────────────────")
    print(f"  Frontend:  https://{pod_id}-3000.proxy.runpod.net")
    print(f"  ComfyUI:   https://{pod_id}-8199.proxy.runpod.net")
    print(f"  Jupyter:   https://{pod_id}-8888.proxy.runpod.net")
    print(f"  SSH:       ssh root@{pod_id}-22.proxy.runpod.net")
    print()
    print(f"  Manage at: https://www.runpod.io/console/pods")
    print()

    return pod_id


def stop_pod(api_key: str, pod_id: str):
    """Stop a pod (keeps volume, stops billing for GPU)."""
    query = """
    mutation($input: PodStopInput!) {
        podStop(input: $input) {
            id
            desiredStatus
        }
    }
    """
    data = graphql(api_key, query, {"input": {"podId": pod_id}})
    pod = data.get("podStop", {})
    print(f"\n  Pod {pod.get('id', pod_id)} → {pod.get('desiredStatus', 'STOPPED')}")
    print(f"  Volume preserved. Resume anytime.\n")


def terminate_pod(api_key: str, pod_id: str):
    """Terminate a pod (deletes everything including volume)."""
    confirm = input(f"\n  WARNING: This will DELETE pod {pod_id} and its volume. Type 'yes' to confirm: ")
    if confirm.strip().lower() != "yes":
        print("  Cancelled.\n")
        return

    query = """
    mutation($input: PodTerminateInput!) {
        podTerminate(input: $input)
    }
    """
    graphql(api_key, query, {"input": {"podId": pod_id}})
    print(f"\n  Pod {pod_id} terminated.\n")


def interactive_gpu_picker():
    """Show GPU menu and return selected GPU type ID."""
    print()
    print("  ╔═══════════════════════════════════════════════╗")
    print("  ║        FEDDA AI Studio — GPU Selector         ║")
    print("  ╠═══════════════════════════════════════════════╣")
    for key, (name, desc) in GPU_PRESETS.items():
        print(f"  ║  [{key}]  {name:<28} {desc:<14} ║")
    print("  ║  [C]  Custom GPU ID                           ║")
    print("  ╚═══════════════════════════════════════════════╝")
    print()

    choice = input("  Select GPU [1-8, C]: ").strip().upper()

    if choice == "C":
        gpu_id = input("  Enter GPU type ID (from --list): ").strip()
        if not gpu_id:
            print("  ERROR: No GPU ID entered.")
            sys.exit(1)
        return gpu_id
    elif choice in GPU_PRESETS:
        return GPU_PRESETS[choice][0]
    else:
        print(f"  Invalid choice: {choice}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="FEDDA AI Studio — RunPod Deployer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python deploy.py                      Interactive GPU picker
  python deploy.py --gpu "RTX 4090"     Deploy with RTX 4090
  python deploy.py --list               List all available GPUs
  python deploy.py --pods               List your running pods
  python deploy.py --stop <pod_id>      Stop pod (preserves volume)
  python deploy.py --terminate <pod_id> Delete pod and volume

Environment:
  RUNPOD_API_KEY    Your RunPod API key (or will be prompted)
        """,
    )
    parser.add_argument("--gpu", type=str, help="GPU type ID or name")
    parser.add_argument("--list", action="store_true", help="List available GPU types")
    parser.add_argument("--pods", action="store_true", help="List your current pods")
    parser.add_argument("--stop", type=str, metavar="POD_ID", help="Stop a pod")
    parser.add_argument("--terminate", type=str, metavar="POD_ID", help="Terminate a pod")
    parser.add_argument("--volume", type=int, default=VOLUME_GB, help=f"Volume size in GB (default: {VOLUME_GB})")
    parser.add_argument("--disk", type=int, default=CONTAINER_DISK_GB, help=f"Container disk in GB (default: {CONTAINER_DISK_GB})")

    args = parser.parse_args()

    # Override defaults if provided
    global VOLUME_GB, CONTAINER_DISK_GB
    VOLUME_GB = args.volume
    CONTAINER_DISK_GB = args.disk

    api_key = get_api_key()

    if args.list:
        list_gpus(api_key)
    elif args.pods:
        list_pods(api_key)
    elif args.stop:
        stop_pod(api_key, args.stop)
    elif args.terminate:
        terminate_pod(api_key, args.terminate)
    else:
        gpu = args.gpu
        if not gpu:
            gpu = interactive_gpu_picker()
        deploy_pod(api_key, gpu)


if __name__ == "__main__":
    main()
