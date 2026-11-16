import { useState } from 'react';
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
  const [step, setStep] = useState<Step>(() => (walkthroughSeen(me.id) ? null : 'walkthrough'));
  if (step === 'walkthrough') {
    return <Walkthrough onDone={() => { markWalkthroughSeen(me.id); setStep(isInstalled() ? null : 'install'); }} />;
  }
  if (step === 'install') return <InstallSteps open onClose={() => setStep(null)} />;
  return null;
}
