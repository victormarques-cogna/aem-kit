/** Author-facing copy used by the scaffold and Drafts, per project language. */
const STRINGS = {
  'pt-BR': {
    headingLabel: 'Título',
    headingDefault: 'Título',
    textLabel: 'Texto',
    textDefault: 'Adicione seu conteúdo aqui.',
    draftDescription: (title) => `Página de rascunho do bloco ${title}`,
    componentTitle: (title) => `Componente ${title}`,
    componentDescription: (title) => `Vitrine do componente ${title}: variantes e estados`,
    componentSample: 'Exemplo',
  },
  en: {
    headingLabel: 'Heading',
    headingDefault: 'Heading',
    textLabel: 'Text',
    textDefault: 'Add your content here.',
    draftDescription: (title) => `Draft page for the ${title} block`,
    componentTitle: (title) => `${title} component`,
    componentDescription: (title) => `Showcase of the ${title} component: variants and states`,
    componentSample: 'Sample',
  },
};

/**
 * @param {string} language
 * @returns {typeof STRINGS['pt-BR'] & { lang: string }}
 */
export default function strings(language) {
  return { ...(STRINGS[language] ?? STRINGS['pt-BR']), lang: language };
}
