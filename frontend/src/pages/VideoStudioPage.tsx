import { Wan22Vid2Vid } from './wan22/Wan22Vid2Vid';
import { Wan22Img2Vid } from './wan22/Wan22Img2Vid';
import { LtxFlfPage } from './ltx/LtxFlfPage';
import { LtxImgAudioPage } from './ltx/LtxImgAudioPage';

interface VideoStudioPageProps {
  activeTab?: string;
}

export const VideoStudioPage = ({ activeTab = 'wan22-vid2vid' }: VideoStudioPageProps) => {
  if (activeTab === 'video' || activeTab === 'wan22-vid2vid') return <Wan22Vid2Vid />;
  if (activeTab === 'wan22-img2vid') return <Wan22Img2Vid />;
  if (activeTab === 'ltx' || activeTab === 'ltx-flf') return <LtxFlfPage />;
  if (activeTab === 'ltx-img-audio') return <LtxImgAudioPage />;
  return <Wan22Vid2Vid />;
};
