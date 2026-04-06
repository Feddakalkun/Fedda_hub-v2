import { LtxFlfPage } from './ltx/LtxFlfPage';

interface LtxStudioPageProps {
  activeTab?: string;
}

export const LtxStudioPage = ({ activeTab = 'ltx-flf' }: LtxStudioPageProps) => {
  if (activeTab === 'ltx' || activeTab === 'ltx-flf') {
    return <LtxFlfPage />;
  }
  return <LtxFlfPage />;
};
