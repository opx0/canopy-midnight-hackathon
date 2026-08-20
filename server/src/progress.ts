// What the server is doing before it can write to the chain. The front page shows
// this verbatim: a visitor who arrives during a restart should be told which of the
// slow steps is running, not shown a progress bar for a scan that is not happening.
export const progress = {
  stage: "starting up",
  since: Date.now(),
};

export const nowDoing = (stage: string): void => {
  progress.stage = stage;
  progress.since = Date.now();
};
