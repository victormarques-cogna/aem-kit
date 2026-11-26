const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Starts the reusable components inside root: every element with data-ui="{name}" gets
 * components/{name}/{name}.js imported (once per page, only when used) and its default
 * export called with the element. Elements already started carry data-ui-ready.
 * @param {Element} root block (or any container)
 * @returns {Promise<void>}
 */
export default async function initComponents(root) {
  const elements = [root, ...root.querySelectorAll('[data-ui]')]
    .filter((el) => el.matches('[data-ui]:not([data-ui-ready])'));
  await Promise.all(elements.map(async (el) => {
    const name = el.getAttribute('data-ui');
    el.setAttribute('data-ui-ready', '');
    if (!NAME.test(name)) {
      // eslint-disable-next-line no-console
      console.error(`ui: data-ui="${name}" inválido`);
      return;
    }
    try {
      const { default: init } = await import(new URL(`../components/${name}/${name}.js`, import.meta.url).href);
      await init(el);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`ui: falha ao iniciar o componente "${name}"`, error);
    }
  }));
}
