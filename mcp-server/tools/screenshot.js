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
    // Bug 3 fix: read data.dataUrl (was data.imageData)
    if (!data.dataUrl) {
      return 'Screenshot taken but no image data returned.';
    }
    const base64 = data.dataUrl.replace(/^data:image\/png;base64,/, '');
    return `Screenshot captured (base64 PNG, ${base64.length} chars):\n${data.dataUrl}`;
  },
};
