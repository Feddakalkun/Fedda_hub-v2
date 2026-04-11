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

KWARG_COMPAT_BLOCK = """

# FEDDA compatibility wrapper for newer Comfy input names like values.a / values.b / values.c
if not getattr(MathExpression, "_fedda_values_kwarg_compat", False):
    _fedda_original_evaluate = MathExpression.evaluate

    def _fedda_compat_evaluate(self, expression, prompt, extra_pnginfo={}, a=None, b=None, c=None, **kwargs):
        if a is None and "values.a" in kwargs:
            a = kwargs["values.a"]
        if b is None and "values.b" in kwargs:
            b = kwargs["values.b"]
        if c is None and "values.c" in kwargs:
            c = kwargs["values.c"]
        return _fedda_original_evaluate(self, expression, prompt, extra_pnginfo=extra_pnginfo, a=a, b=b, c=c)

    MathExpression.evaluate = _fedda_compat_evaluate
    MathExpression._fedda_values_kwarg_compat = True
""".strip("\n")


def apply_patch() -> None:
    root = Path(__file__).resolve().parent.parent
    target = root / "ComfyUI" / "custom_nodes" / "ComfyUI-Custom-Scripts" / "py" / "math_expression.py"

    if not target.exists():
        print("ComfyUI-Custom-Scripts math_expression.py not found, skipping patch.")
        return

    content = target.read_text(encoding="utf-8")
    if "NODE_DISPLAY_NAME_MAPPINGS = {" not in content:
        raise RuntimeError("Could not find expected NODE_DISPLAY_NAME_MAPPINGS block in math_expression.py")

    blocks_to_add = []
    if 'NODE_CLASS_MAPPINGS["ComfyMathExpression"]' not in content:
        blocks_to_add.append(ALIAS_BLOCK)
    if "MathExpression._fedda_values_kwarg_compat" not in content:
        blocks_to_add.append(KWARG_COMPAT_BLOCK)

    if not blocks_to_add:
        print("MathExpression compatibility patches already present.")
        return

    updated = content.rstrip() + "\n\n" + "\n\n".join(blocks_to_add) + "\n"
    target.write_text(updated, encoding="utf-8")
    print("Added MathExpression compatibility patches.")


if __name__ == "__main__":
    apply_patch()
