import { moveInstrumentation } from './scripts.js';

const AUTHORING_ATTRS = [
  'data-block',
  'data-title',
  'data-item',
  'data-item-title',
  'data-field',
  'data-component',
  'data-label',
  'data-multi',
];

/**
 * Removes authoring markers from a rendered template.
 * @param {Element} root Template root
 */
function clean(root) {
  [root, ...root.querySelectorAll('*')].forEach((el) => {
    AUTHORING_ATTRS.forEach((name) => el.removeAttribute(name));
  });
}

/**
 * @param {Element} cell Authored cell
 * @returns {boolean} True when the cell has text or media
 */
function cellHasContent(cell) {
  return cell.textContent.trim() || cell.querySelector('img, picture, a');
}

/**
 * Repeats a multi-value slot once per authored value (AEM delivers them as <ul><li>).
 * @param {Element} slot Template element marked with data-multi
 * @param {Element} [cell] Authored cell
 */
function fillMulti(slot, cell) {
  const items = cell ? [...cell.querySelectorAll('li')] : [];
  const values = items.length
    ? items.map((li) => li.textContent.trim())
    : [cell?.textContent.trim() ?? ''];
  const copies = values.filter(Boolean).map((value) => {
    const copy = slot.cloneNode(true);
    copy.textContent = value;
    return copy;
  });
  slot.replaceWith(...copies);
}

/**
 * Copies authored cells into template slots, in document order.
 * @param {Element[]} slots Field slots
 * @param {Element[]} cells Authored cells
 */
function fillSlots(slots, cells) {
  slots.forEach((slot, index) => {
    const cell = cells[index];
    if (slot.hasAttribute('data-multi')) {
      fillMulti(slot, cell);
      return;
    }
    if (!cell) return;
    const kind = slot.getAttribute('data-component') || 'text';
    if (kind === 'text') slot.textContent = cell.textContent.trim();
    else slot.replaceChildren(...cell.childNodes);
  });
}

/**
 * @param {Element} scope
 * @param {Element} [item]
 * @returns {Element[]}
 */
function fieldSlots(scope, item) {
  return [...scope.querySelectorAll('[data-field]')].filter((slot) => {
    if (!item) return true;
    return !item.contains(slot);
  });
}

/**
 * Paints an authored block with the HTML template produced by build-blocks.
 * @param {Element} block Block element
 * @param {string} template HTML source from blocks/{name}/{name}.html
 */
export default function renderTemplate(block, template) {
  const root = new DOMParser().parseFromString(template, 'text/html').body.firstElementChild;
  if (!root) return;

  const itemTemplate = root.querySelector('[data-item]');
  if (itemTemplate) {
    const blockSlots = fieldSlots(root, itemTemplate);
    const rows = [...block.children];
    const blockRows = rows.slice(0, blockSlots.length);
    const itemRows = rows.slice(blockSlots.length);

    fillSlots(
      blockSlots,
      blockRows.map((row) => row.firstElementChild).filter(Boolean),
    );

    const host = itemTemplate.parentElement;
    itemTemplate.remove();
    itemRows.forEach((row) => {
      const cells = [...row.children];
      if (!cells.some(cellHasContent)) return;
      const item = itemTemplate.cloneNode(true);
      fillSlots([...item.querySelectorAll('[data-field]')], cells);
      moveInstrumentation(row, item);
      host.append(item);
    });

    if (blockSlots.length && block.firstElementChild) {
      moveInstrumentation(block.firstElementChild, root);
    }
  } else {
    const cells = [...block.children].flatMap((row) => [...row.children]);
    fillSlots(fieldSlots(root), cells);
    if (block.firstElementChild) moveInstrumentation(block.firstElementChild, root);
  }

  clean(root);
  [...root.classList].forEach((cls) => block.classList.add(cls));
  block.replaceChildren(...root.childNodes);
}
