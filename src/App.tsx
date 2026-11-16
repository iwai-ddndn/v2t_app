import { Toaster } from '@/components/ui/sonner';
import { useRoute } from '@/hooks/use-route';
import { useApplyTheme } from '@/hooks/use-theme';
import { useSettings } from '@/store/settings';
import { LiveScreen } from '@/screens/live';
import { SettingsScreen } from '@/screens/settings';
import { HistoryDetailScreen, HistoryScreen } from '@/screens/history';
import { LabScreen } from '@/screens/lab';
import { Onboarding } from '@/screens/onboarding';

export default function App() {
  useApplyTheme();
  const route = useRoute();
  const onboarded = useSettings((s) => s.onboarded);

  let screen;
  if (!onboarded) screen = <Onboarding />;
  else if (route === '/settings') screen = <SettingsScreen />;
  else if (route === '/history') screen = <HistoryScreen />;
  else if (route.startsWith('/history/')) screen = <HistoryDetailScreen id={decodeURIComponent(route.slice(9))} />;
  else if (route === '/lab') screen = <LabScreen />;
  else screen = <LiveScreen />;

  return (
    <>
      {/* 録音画面はアンマウントしない方が安全だが、録音状態は store にあるので画面を切り替えても録音は続く */}
      {screen}
      <Toaster />
    </>
  );
}
