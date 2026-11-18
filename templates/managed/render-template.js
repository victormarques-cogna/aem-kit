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
  'data-options',
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
 * Select: exposes the chosen value as data-{field} (style it with data-[field=value]:…).
 * @param {Element} slot
 * @param {Element} [cell]
 */
function fillSelect(slot, cell) {
  const [first] = (slot.getAttribute('data-options') || '').split(',');
  const fallback = (first || '').split(':')[0].trim();
  const value = cell?.textContent.trim() || fallback;
  slot.setAttribute(`data-${slot.getAttribute('data-field')}`, value);
}

/**
 * Link: AEM delivers `{field}` + `{field}Text` as one <a>; copy href, text and title.
 * @param {Element} slot Template <a>
 * @param {Element} [cell]
 */
function fillLink(slot, cell) {
  const link = cell?.querySelector('a');
  const text = (link || cell)?.textContent.trim();
  if (!link && !text) {
    slot.remove();
    return;
  }
  if (link) {
    slot.setAttribute('href', link.getAttribute('href'));
    if (link.title) slot.setAttribute('title', link.title);
  }
  if (text) slot.textContent = text;
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
    const kind = slot.getAttribute('data-component') || 'text';
    if (kind === 'select') {
      fillSelect(slot, cell);
      return;
    }
    if (kind === 'link') {
      fillLink(slot, cell);
      return;
    }
    if (!cell) return;
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
 * Splits a composite multi-field cell into entries: <ul><li> (one element per entry)
 * or a flat list where every entry is preceded by <hr>.
 * @param {Element} [cell]
 * @returns {Element[][]} Elements of each entry
 */
function compositeEntries(cell) {
  if (!cell) return [];
  const list = cell.querySelector(':scope > ul');
  if (list && !cell.querySelector(':scope > hr')) return [...list.children].map((li) => [li]);
  const entries = [];
  let current = null;
  [...cell.children].forEach((el) => {
    if (el.tagName === 'HR') {
      current = [];
      entries.push(current);
    } else {
      if (!current) {
        current = [];
        entries.push(current);
      }
      current.push(el);
    }
  });
  return entries.filter((entry) => entry.some((el) => el.textContent.trim() || el.querySelector('img, picture, a')));
}

/**
 * Fills one entry: pictures go to reference fields, links to link fields and the
 * remaining text blocks to text/richtext/select fields, each in document order.
 * A select only takes a text that is one of its options (else its default).
 * @param {Element[]} slots Sub-field slots of the cloned item
 * @param {Element[]} elements Elements of the entry
 */
function fillEntry(slots, elements) {
  const pictures = elements.filter((el) => el.querySelector('picture, img') || el.matches('picture, img'));
  const links = elements.filter((el) => !pictures.includes(el) && (el.matches('a') || el.querySelector('a')));
  const texts = elements.filter((el) => !pictures.includes(el) && !links.includes(el));

  slots.forEach((slot) => {
    const kind = slot.getAttribute('data-component') || 'text';
    if (kind === 'select') {
      const values = (slot.getAttribute('data-options') || '').split(',').map((entry) => entry.split(':')[0].trim());
      const candidate = texts[0]?.textContent.trim();
      fillSelect(slot, values.includes(candidate) ? texts.shift() : null);
    } else if (kind === 'reference') {
      const picture = pictures.shift();
      if (picture) slot.replaceChildren(...(picture.matches('picture, img') ? [picture] : picture.childNodes));
      else slot.replaceChildren();
    } else if (kind === 'link') {
      fillLink(slot, links.shift());
    } else if (kind === 'richtext') {
      const text = texts.shift();
      slot.replaceChildren(...(text ? [text] : []));
    } else {
      slot.textContent = texts.shift()?.textContent.trim() ?? '';
    }
  });
}

/**
 * Removes every data-item under host and returns a clone of the first as template.
 * Extra data-item siblings in the Block Source are Draft samples only.
 * @param {Element} host
 * @param {Element} itemTemplate
 * @returns {Element}
 */
function takeItemTemplate(host, itemTemplate) {
  const template = itemTemplate.cloneNode(true);
  [...host.querySelectorAll(':scope > [data-item]')].forEach((el) => el.remove());
  return template;
}

/**
 * Repeats the item template once per entry of a composite multi-field.
 * @param {Element} itemTemplate Element with data-item + data-multi
 * @param {Element} [cell]
 */
function fillComposite(itemTemplate, cell) {
  const host = itemTemplate.parentElement;
  const template = takeItemTemplate(host, itemTemplate);
  compositeEntries(cell).forEach((elements) => {
    const item = template.cloneNode(true);
    const slots = [...item.querySelectorAll('[data-field]')];
    if (item.hasAttribute('data-field')) slots.unshift(item);
    fillEntry(slots, elements);
    host.append(item);
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
  if (itemTemplate?.hasAttribute('data-multi')) {
    // Composite multi-field: one cell (row) per block field, the item list being one of them.
    const cells = [...block.children].flatMap((row) => [...row.children]);
    const slots = [...root.querySelectorAll('[data-field], [data-item]')]
      .filter((slot) => {
        if (slot.hasAttribute('data-item')) return slot === itemTemplate;
        return !slot.closest('[data-item]');
      });
    slots.forEach((slot, index) => {
      if (slot === itemTemplate) fillComposite(slot, cells[index]);
      else fillSlots([slot], [cells[index]]);
    });
    if (block.firstElementChild) moveInstrumentation(block.firstElementChild, root);
  } else if (itemTemplate) {
    const blockSlots = fieldSlots(root, itemTemplate);
    const rows = [...block.children];
    const blockRows = rows.slice(0, blockSlots.length);
    const itemRows = rows.slice(blockSlots.length);

    fillSlots(
      blockSlots,
      blockRows.map((row) => row.firstElementChild).filter(Boolean),
    );

    const host = itemTemplate.parentElement;
    const templateEl = takeItemTemplate(host, itemTemplate);
    itemRows.forEach((row) => {
      const cells = [...row.children];
      if (!cells.some(cellHasContent)) return;
      const item = templateEl.cloneNode(true);
      // The item element itself may be a field (e.g. a select that colors the card).
      const slots = [...item.querySelectorAll('[data-field]')];
      if (item.hasAttribute('data-field')) slots.unshift(item);
      fillSlots(slots, cells);
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
