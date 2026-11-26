// The guide observes the same field and trader records as ordinary play.
// Its checkpoint and the action that changed it share one session revision.
const ONBOARDING_QUEST = 'supply-pantry';
const ONBOARDING_MODES = ['available', 'active', 'skipped', 'completed'];
const ONBOARDING_STEPS = ['accept', 'busy', 'deploy', 'search', 'extract', 'debrief', 'claim',
  'failed', 'retry', 'unassigned', 'done'];
let onboardingState = {mode:'active', step:'accept'};

function validOnboardingCheckpoint(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    ONBOARDING_MODES.includes(value.mode) && ONBOARDING_STEPS.includes(value.step) &&
    (value.mode !== 'completed' || value.step === 'done');
}

function loadOnboarding(saved, existingPlayer) {
  onboardingState = validOnboardingCheckpoint(saved)
    ? {mode:saved.mode, step:saved.step}
    : {mode:existingPlayer ? 'available' : 'active', step:'accept'};
}

function onboardingStep(questStatus, goal) {
  if (questStatus === 'claimed') return 'done';
  if (raid) {
    if (field.result) return field.result === 'success' ? 'debrief' : 'failed';
    if (questStatus === 'ready') return 'extract';
    if (questStatus !== 'active') return 'unassigned';
    const searched = Object.keys(field.boxes).some(key =>
      field.boxes[key].complete && contractBoxMatches(goal, key));
    return searched ? 'extract' : 'search';
  }
  if (questStatus === 'ready') return 'claim';
  if (questStatus === 'busy') return 'busy';
  if (questStatus !== 'active') return 'accept';
  // The settlement survives acknowledgement, including when the player accepts the quest after a loss.
  if (lastSummary && lastSummary.result !== 'success') return 'retry';
  return 'deploy';
}

function onboardingView() {
  const quest = CONTRACT_BY_ID.get(ONBOARDING_QUEST), goal = quest.goals[0];
  const questStatus = contractStatus(quest.id).status;
  const step = onboardingStep(questStatus, goal);
  let {mode} = onboardingState;
  // Only the actual trader receipt closes an active guide. A guide never issues a reward.
  if (mode === 'active' && step === 'done') mode = 'completed';
  if (mode === 'completed' && step !== 'done') mode = 'active';
  return {mode, step, quest, goal, questStatus};
}

function onboardingCheckpoint() {
  const {mode, step} = onboardingView();
  return {mode, step};
}

function setOnboardingMode(mode) {
  if (!writer || (mode !== 'active' && mode !== 'skipped')) return false;
  const current = onboardingView();
  if (current.mode === 'completed') return false;
  if (current.mode === mode) return true;
  const before = onboardingState, inventory = stash;
  onboardingState = {mode, step:current.step};
  if (writeSession()) return true;
  // A revision conflict has already loaded the winner's complete save.
  if (stash === inventory) onboardingState = before;
  return false;
}
