/**
 * The tab title: the app's name, unless a page asks for its own (the public profile link, item 34:
 * "<name> on Media Tracker"). One owner for document.title, so the brand effect and the page never
 * overwrite each other whichever runs last.
 */
let brand = 'Media Tracker';
let override: string | null = null;
const apply = () => { document.title = override ?? brand; };

export function setBrandTitle(name: string): void { brand = name; apply(); }
export function setTitleOverride(title: string | null): void { override = title; apply(); }
