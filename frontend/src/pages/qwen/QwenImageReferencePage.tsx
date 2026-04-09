import { Txt2ImgPage } from '../zimage/ZImageTxt2Img';

export const QwenImageReferencePage = () => {
  const QWEN_ASPECT_PRESETS = [
    { label: '1:1', w: 1328, h: 1328 },
    { label: '16:9', w: 1664, h: 928 },
    { label: '9:16', w: 928, h: 1664 },
    { label: '4:3', w: 1472, h: 1104 },
    { label: '3:4', w: 1104, h: 1472 },
    { label: '3:2', w: 1584, h: 1056 },
    { label: '2:3', w: 1056, h: 1584 },
  ];

  return (
    <Txt2ImgPage
      storageKey="qwen_image_ref"
      workflowId="qwen-edit-2509-image-reference"
      familyLabel="Qwen Image Reference"
      promptContext="zimage"
      accent="emerald"
      loraPrefixes={['qwen/']}
      loraPacks={[]}
      aspectPresets={QWEN_ASPECT_PRESETS}
      allowedResolutions={QWEN_ASPECT_PRESETS}
      requireImageUpload
      imageParamKey="image"
      imageLabel="Reference Image"
    />
  );
};

