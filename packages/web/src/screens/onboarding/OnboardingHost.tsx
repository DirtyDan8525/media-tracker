import { useState } from 'react';
import { useAppSettings } from '../../data/appSettings';
import { useSessionMe } from '../../shell/SessionGate';
import { InstallSteps } from './InstallSteps';
import { isInstalled } from './install';
import { markWalkthroughSeen, walkthroughSeen } from './storage';
import { Walkthrough } from './Walkthrough';

type Step = 'walkthrough' | 'install' | null;

/**
 * Shown once after a user's first successful sign-in (or sign-up and approval): the walkthrough,
 * then the install steps (unless already installed). Mount it once inside the signed-in app frame.
 * Skipping the install steps leaves the Home banner for later.
 */
export function OnboardingHost() {
  const me = useSessionMe();
  const { features } = useAppSettings();
  const [step, setStep] = useState<Step>(() => (walkthroughSeen(me.id) ? null : 'walkthrough'));
  // AD2: with the walkthrough switched off the first-run tour is skipped; with the install banner off, so are the install steps.
  if (step === 'walkthrough' && features.walkthrough) {
    return <Walkthrough onDone={() => { markWalkthroughSeen(me.id); setStep(isInstalled() || !features.installBanner ? null : 'install'); }} />;
  }
  if (step === 'install' && features.installBanner) return <InstallSteps open onClose={() => setStep(null)} />;
  return null;
}
