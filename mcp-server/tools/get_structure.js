export const getStructureTool = {
  name: 'get_page_structure',
  description:
    'Get structured content from the current page: title, headings, links, word count, publish date, author, and meta description. Ideal for content analysis and SEO audits.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, send) {
    const data = await send('GET_STRUCTURE', {});
    return JSON.stringify(data, null, 2);
  },
};
