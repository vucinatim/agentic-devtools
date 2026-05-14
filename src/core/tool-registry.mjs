export const tools = {
  namecheap: {
    name: "namecheap",
    description: "Inspect and manage Namecheap domains and DNS.",
    mcpModule: "../tools/namecheap/mcp.mjs",
  },
  railway: {
    name: "railway",
    description: "Inspect Railway projects, environments, and deployments.",
    mcpModule: "../tools/railway/mcp.mjs",
  },
  npm: {
    name: "npm",
    description: "Inspect npm packages, auth, tokens, and publishing setup.",
    mcpModule: "../tools/npm/mcp.mjs",
  },
};

export const listTools = () => Object.values(tools);

export const getTool = (name) => {
  const tool = tools[name];
  if (!tool) {
    throw new Error(
      `Unknown tool "${name}". Available tools: ${Object.keys(tools).join(", ")}`,
    );
  }
  return tool;
};
