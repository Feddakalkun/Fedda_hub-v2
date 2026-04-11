"""
Add a backwards-compatible node alias for older workflows that expect
`ComfyMathExpression` from ComfyUI-Custom-Scripts.
"""

from pathlib import Path


ALIAS_BLOCK = """

# FEDDA compatibility alias for older workflows
if "MathExpression|pysssss" in NODE_CLASS_MAPPINGS and "ComfyMathExpression" not in NODE_CLASS_MAPPINGS:
    NODE_CLASS_MAPPINGS["ComfyMathExpression"] = NODE_CLASS_MAPPINGS["MathExpression|pysssss"]
    NODE_DISPLAY_NAME_MAPPINGS["ComfyMathExpression"] = NODE_DISPLAY_NAME_MAPPINGS.get(
        "MathExpression|pysssss",
        "Math Expression"
    )
""".strip("\n")


def apply_patch() -> None:
    root = Path(__file__).resolve().parent.parent
    target = root / "ComfyUI" / "custom_nodes" / "ComfyUI-Custom-Scripts" / "py" / "math_expression.py"

    if not target.exists():
        print("ComfyUI-Custom-Scripts math_expression.py not found, skipping patch.")
        return

    content = target.read_text(encoding="utf-8")
    if 'NODE_CLASS_MAPPINGS["ComfyMathExpression"]' in content:
        print("ComfyMathExpression alias already present.")
        return

    if "NODE_DISPLAY_NAME_MAPPINGS = {" not in content:
        raise RuntimeError("Could not find expected NODE_DISPLAY_NAME_MAPPINGS block in math_expression.py")

    updated = content.rstrip() + "\n\n" + ALIAS_BLOCK + "\n"
    target.write_text(updated, encoding="utf-8")
    print("Added ComfyMathExpression compatibility alias.")


if __name__ == "__main__":
    apply_patch()
