import { ZImageTxt2Img } from './zimage/ZImageTxt2Img';
import { Sparkles } from 'lucide-react';
import { PlaceholderPage } from './PlaceholderPage';
import { FluxTxt2Img } from './flux/FluxTxt2Img';
import { QwenTxt2Img } from './qwen/QwenTxt2Img';
import { QwenImageReferencePage } from './qwen/QwenImageReferencePage';
import { QwenMultiAnglesPage } from './qwen/QwenMultiAnglesPage';

interface ImageStudioPageProps {
  activeTab?: string;
}

export const ImageStudioPage = ({ activeTab = 'z-image' }: ImageStudioPageProps) => {
  // If the user clicks the "Image Studio" parent icon or its "z-image" subitem
  if (activeTab === 'image' || activeTab === 'z-image' || activeTab === 'z-image-txt2img') {
    return <ZImageTxt2Img />;
  }

  // Placeholder for the other sub-tabs we haven't implemented yet
  if (activeTab === 'flux' || activeTab === 'flux-txt2img') {
    return <FluxTxt2Img />;
  }

  if (activeTab === 'qwen' || activeTab === 'qwen-txt2img') {
    return <QwenTxt2Img />;
  }

  if (activeTab === 'qwen-image-ref') {
    return <QwenImageReferencePage />;
  }

  if (activeTab === 'qwen-multi-angle') {
    return <QwenMultiAnglesPage />;
  }

  if (activeTab === 'image-other') {
    return <PlaceholderPage label="Other Workflows" description="Uncategorized image processing capabilities coming soon." icon={<Sparkles className="w-8 h-8" />} />;
  }

  return <ZImageTxt2Img />; // Fallback
};
