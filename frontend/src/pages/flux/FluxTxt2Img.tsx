import { Txt2ImgPage } from '../zimage/ZImageTxt2Img';

// Temporary workflow bridge:
// Until a dedicated Flux backend workflow is added, we reuse the same txt2img payload surface.
export const FluxTxt2Img = () => {
  return (
    <Txt2ImgPage
      storageKey="flux_txt2img"
      workflowId="z-image"
      familyLabel="FLUX2-KLEIN"
      promptContext="zimage"
      accent="violet"
      loraPrefixes={['flux2klein/', 'flux1dev/']}
      loraPacks={['flux2klein', 'flux1dev']}
    />
  );
};
