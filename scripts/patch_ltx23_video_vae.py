from pathlib import Path
import sys


def patch_file(path: Path) -> bool:
    if not path.exists():
        return False

    text = path.read_text(encoding="utf-8")
    original = text

    encoder_old = """        self.encoder = Encoder(
            dims=config["dims"],
            in_channels=config.get("in_channels", 3),
            out_channels=config["latent_channels"],
            blocks=config.get("encoder_blocks", config.get("encoder_blocks", config.get("blocks"))),
            patch_size=config.get("patch_size", 1),
            latent_log_var=latent_log_var,
            norm_layer=config.get("norm_layer", "group_norm"),
            spatial_padding_mode=config.get("spatial_padding_mode", "zeros"),
        )
"""
    encoder_new = """        self.encoder = Encoder(
            dims=config["dims"],
            in_channels=config.get("in_channels", 3),
            out_channels=config["latent_channels"],
            blocks=config.get("encoder_blocks", config.get("encoder_blocks", config.get("blocks"))),
            base_channels=config.get("encoder_base_channels", 128),
            patch_size=config.get("patch_size", 1),
            latent_log_var=latent_log_var,
            norm_layer=config.get("norm_layer", "group_norm"),
            spatial_padding_mode=config.get("spatial_padding_mode", "zeros"),
        )
"""
    text = text.replace(encoder_old, encoder_new)

    decoder_old = """        self.decoder = Decoder(
            dims=config["dims"],
            in_channels=config["latent_channels"],
            out_channels=config.get("out_channels", 3),
            blocks=config.get("decoder_blocks", config.get("decoder_blocks", config.get("blocks"))),
            patch_size=config.get("patch_size", 1),
            norm_layer=config.get("norm_layer", "group_norm"),
            causal=config.get("causal_decoder", False),
            timestep_conditioning=self.timestep_conditioning,
            spatial_padding_mode=config.get("spatial_padding_mode", "reflect"),
        )
"""
    decoder_new = """        self.decoder = Decoder(
            dims=config["dims"],
            in_channels=config["latent_channels"],
            out_channels=config.get("out_channels", 3),
            blocks=config.get("decoder_blocks", config.get("decoder_blocks", config.get("blocks"))),
            base_channels=config.get("decoder_base_channels", 128),
            patch_size=config.get("patch_size", 1),
            norm_layer=config.get("norm_layer", "group_norm"),
            causal=config.get("causal_decoder", False),
            timestep_conditioning=self.timestep_conditioning,
            spatial_padding_mode=config.get("spatial_padding_mode", "reflect"),
        )
"""
    text = text.replace(decoder_old, decoder_new)

    output_old = """        # Compute output channel to be product of all channel-multiplier blocks
        output_channel = base_channels
        for block_name, block_params in list(reversed(blocks)):
            block_params = block_params if isinstance(block_params, dict) else {}
            if block_name == "res_x_y":
                output_channel = output_channel * block_params.get("multiplier", 2)
            if block_name == "compress_all":
                output_channel = output_channel * block_params.get("multiplier", 1)
"""
    output_new = """        # Compute the decoder entry channels from all upsample/compression blocks.
        # Newer LTX 2.3 VAEs use `compress_space` / `compress_time` blocks with
        # implicit channel expansion, so we need to count those as well.
        output_channel = base_channels
        for block_name, block_params in list(reversed(blocks)):
            block_params = block_params if isinstance(block_params, dict) else {}
            if block_name == "res_x_y":
                output_channel = output_channel * block_params.get("multiplier", 2)
            if block_name in ("compress_space", "compress_time"):
                output_channel = output_channel * block_params.get("multiplier", 2)
            if block_name == "compress_all":
                output_channel = output_channel * block_params.get("multiplier", 1)
"""
    text = text.replace(output_old, output_new)

    compress_time_old = """            elif block_name == "compress_time":
                block = DepthToSpaceUpsample(
                    dims=dims,
                    in_channels=input_channel,
                    stride=(2, 1, 1),
                    spatial_padding_mode=spatial_padding_mode,
                )
"""
    compress_time_new = """            elif block_name == "compress_time":
                output_channel = output_channel // block_params.get("multiplier", 2)
                block = DepthToSpaceUpsample(
                    dims=dims,
                    in_channels=input_channel,
                    stride=(2, 1, 1),
                    out_channels_reduction_factor=block_params.get("multiplier", 2),
                    spatial_padding_mode=spatial_padding_mode,
                )
"""
    text = text.replace(compress_time_old, compress_time_new)

    compress_space_old = """            elif block_name == "compress_space":
                block = DepthToSpaceUpsample(
                    dims=dims,
                    in_channels=input_channel,
                    stride=(1, 2, 2),
                    spatial_padding_mode=spatial_padding_mode,
                )
"""
    compress_space_new = """            elif block_name == "compress_space":
                output_channel = output_channel // block_params.get("multiplier", 2)
                block = DepthToSpaceUpsample(
                    dims=dims,
                    in_channels=input_channel,
                    stride=(1, 2, 2),
                    out_channels_reduction_factor=block_params.get("multiplier", 2),
                    spatial_padding_mode=spatial_padding_mode,
                )
"""
    text = text.replace(compress_space_old, compress_space_new)

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    target = root / "ComfyUI" / "comfy" / "ldm" / "lightricks" / "vae" / "causal_video_autoencoder.py"
    if not target.exists():
        print(f"[LTX23 VAE Patch] Target not found: {target}")
        return 0

    changed = patch_file(target)
    if changed:
        print(f"[LTX23 VAE Patch] Patched {target}")
    else:
        print(f"[LTX23 VAE Patch] Already patched: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
