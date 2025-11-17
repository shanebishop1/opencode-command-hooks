export const EnvProtection = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  return {
    "tool.execute.after": async (input, output) => {
      console.log("Tool execution completed.");
    },
    "tool.execute.before": async (input, output) => {
      console.log("Preparing to execute tool.");
    },
  };
};
