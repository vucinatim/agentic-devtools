export const createJsonResult = (value) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ],
  structuredContent: value,
});

export const printJson = (value) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};
