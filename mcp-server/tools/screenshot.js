export const screenshotTool = {
  name: 'take_screenshot',
  description:
    'Take a screenshot of the current browser tab. ' +
    'Returns a base64-encoded PNG image.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const data = await send('SCREENSHOT', {}, 15000);
    if (!data.imageData) {
      return 'Screenshot taken but no image data returned.';
    }
    // Return as base64 image content
    return `Screenshot captured (base64 PNG, ${data.imageData.length} chars):\ndata:image/png;base64,${data.imageData}`;
  },
};
