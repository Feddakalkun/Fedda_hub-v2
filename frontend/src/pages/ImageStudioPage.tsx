import { ZImageTxt2Img } from './zimage/ZImageTxt2Img';
import { Sparkles } from 'lucide-react';
import { PlaceholderPage } from './PlaceholderPage';

interface ImageStudioPageProps {
  activeTab?: string;
}

export const ImageStudioPage = ({ activeTab = 'z-image' }: ImageStudioPageProps) => {
  // If the user clicks the "Image Studio" parent icon or its "z-image" subitem
  if (activeTab === 'image' || activeTab === 'z-image') {
    return <ZImageTxt2Img />;
  }

  // Placeholder for the other sub-tabs we haven't implemented yet
  if (activeTab === 'flux') {
    return <PlaceholderPage label="Flux Studio" description="Flux operations and tools coming soon." icon={<Sparkles className="w-8 h-8" />} />;
  }

  if (activeTab === 'qwen') {
    return <PlaceholderPage label="Qwen Studio" description="Qwen structural operations coming soon." icon={<Sparkles className="w-8 h-8" />} />;
  }

  if (activeTab === 'image-other') {
    return <PlaceholderPage label="Other Workflows" description="Uncategorized image processing capabilities coming soon." icon={<Sparkles className="w-8 h-8" />} />;
  }

  return <ZImageTxt2Img />; // Fallback
};
