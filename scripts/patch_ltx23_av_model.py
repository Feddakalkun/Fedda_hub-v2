from __future__ import annotations

from pathlib import Path
import shutil
import sys

REQUIRED_MARKERS = {
    "av_model.py": [
        "class GatedCrossAttention(CrossAttention):",
        'self.connector_apply_gated_attention = kwargs.get("connector_apply_gated_attention", False)',
        "self.caption_projection = None",
        "self.audio_caption_projection = None",
        "self.prompt_adaln_single = AdaLayerNormSingle(",
        "gated_attention=self.connector_apply_gated_attention",
        "prompt_timesteps = [None, None]",
    ],
    "embeddings_connector.py": [
        "class GatedCrossAttention(CrossAttention):",
        "gated_attention=False",
        "self.attn1 = GatedCrossAttention(",
    ],
}


def root_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def template_dir(root: Path) -> Path:
    return root / "scripts" / "templates" / "ltx23" / "lightricks"


def target_dir(root: Path) -> Path:
    return root / "ComfyUI" / "comfy" / "ldm" / "lightricks"


def ensure_templates(root: Path) -> None:
    missing = [name for name in REQUIRED_MARKERS if not (template_dir(root) / name).exists()]
    if missing:
        raise FileNotFoundError(f"Missing LTX23 AV templates: {', '.join(missing)}")


def patch_files(root: Path) -> bool:
    ensure_templates(root)
    changed = False
    for name in REQUIRED_MARKERS:
        src = template_dir(root) / name
        dst = target_dir(root) / name
        if not dst.exists():
            raise FileNotFoundError(f"LTX23 AV patch target not found: {dst}")
        if src.read_bytes() != dst.read_bytes():
            shutil.copy2(src, dst)
            changed = True
    return changed


def check_files(root: Path) -> tuple[bool, list[str]]:
    errors: list[str] = []
    for name, markers in REQUIRED_MARKERS.items():
        target = target_dir(root) / name
        if not target.exists():
            errors.append(f"missing target: {target}")
            continue
        text = target.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                errors.append(f"{name} missing marker: {marker}")
    return (len(errors) == 0, errors)


def main(argv: list[str]) -> int:
    root = root_dir()
    check_only = "--check" in argv
    try:
        if not check_only:
            changed = patch_files(root)
            print(f"[LTX23 AV Patch] {'Patched' if changed else 'Already patched'} {target_dir(root)}")
        ok, errors = check_files(root)
    except Exception as exc:
        print(f"[LTX23 AV Patch] ERROR: {exc}")
        return 1

    if ok:
        print("[LTX23 AV Patch] Health check passed.")
        return 0

    for error in errors:
        print(f"[LTX23 AV Patch] Health check failed: {error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
