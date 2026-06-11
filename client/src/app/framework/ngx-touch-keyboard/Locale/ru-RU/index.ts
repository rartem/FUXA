import { Layout, Display, Locale } from '../type';
import { fnDisplay } from '../constants';

const layouts: Layout = {
  text_alphabetic: [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
    ['{shift}', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '{backspace}'],
    ['{numeric}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  text_shift: [
    ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
    ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э', 'Ё'],
    ['{shift}', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '{backspace}'],
    ['{numeric}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  text_numeric: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '₽', '&', '@', '"'],
    ['{symbolic}', '.', ',', '?', '!', '\'', '{backspace}'],
    ['{alphabetic}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  text_symbolic: [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '€', '£', '$', '•'],
    ['{numeric}', '.', ',', '?', '!', '\'', '{backspace}'],
    ['{alphabetic}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  search_alphabetic: [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
    ['{shift}', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '{backspace}'],
    ['{numeric}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  search_shift: [
    ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
    ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э', 'Ё'],
    ['{shift}', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '{backspace}'],
    ['{numeric}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  search_numeric: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '₽', '&', '@', '"'],
    ['{symbolic}', '.', ',', '?', '!', '\'', '{backspace}'],
    ['{alphabetic}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  search_symbolic: [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '€', '£', '$', '•'],
    ['{numeric}', '.', ',', '?', '!', '\'', '{backspace}'],
    ['{alphabetic}', '{language}', '{numpad}', '{space}', '{done}', '{enter}'],
  ],
  email_alphabetic: [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
    ['{shift}', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '{backspace}'],
    ['{numeric}', '{language}', '@', '{space}', '.', '{done}', '{enter}'],
  ],
  email_shift: [
    ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
    ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э', 'Ё'],
    ['{shift}', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '{backspace}'],
    ['{numeric}', '{language}', '@', '{space}', '.', '{done}', '{enter}'],
  ],
  email_numeric: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['$', '!', '~', '&', '=', '#', '[', ']'],
    ['{symbolic}', '.', '_', '-', '+', '{backspace}'],
    ['{alphabetic}', '{language}', '@', '{space}', '.', '{done}', '{enter}'],
  ],
  email_symbolic: [
    ['`', '|', '{', '}', '?', '%', '^', '*', '/', '\''],
    ['$', '!', '~', '&', '=', '#', '[', ']'],
    ['{numeric}', '.', '_', '-', '+', '{backspace}'],
    ['{alphabetic}', '{language}', '@', '{space}', '.', '{done}', '{enter}'],
  ],
  url_alphabetic: [
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
    ['{shift}', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '{backspace}'],
    ['{numeric}', '{language}', '/', '.com', '.', '{done}', '{enter}'],
  ],
  url_shift: [
    ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
    ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э', 'Ё'],
    ['{shift}', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '{backspace}'],
    ['{numeric}', '{language}', '/', '.com', '.', '{done}', '{enter}'],
  ],
  url_numeric: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '&', '%', '?', ',', '=', '[', ']'],
    ['{symbolic}', '_', ':', '-', '+', '{backspace}'],
    ['{alphabetic}', '{language}', '/', '.com', '.', '{done}', '{enter}'],
  ],
  url_symbolic: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['*', '$', '#', '!', '\'', '^', '[', ']'],
    ['{numeric}', '~', ';', '(', ')', '{backspace}'],
    ['{alphabetic}', '{language}', '/', '.com', '.', '{done}', '{enter}'],
  ],
  numeric_default: [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['{abc}', '0', '{backspace}', '{enter}'],
  ],
  decimal_default: [
    ['1', '2', '3', '-'],
    ['4', '5', '6', '+'],
    ['7', '8', '9', '{backspace}'],
    ['{abc}', '{done}', '0', '.', '{enter}'],
  ],
  tel_default: [
    ['1', '2', '3', '*'],
    ['4', '5', '6', '#'],
    ['7', '8', '9', '+'],
    ['{abc}', '0', '{backspace}', '{enter}'],
  ],
};

const display: Display = {
  '{enter}': fnDisplay.ENTER,
  '{done}': fnDisplay.DONE,
  '{shift}': fnDisplay.SHIFT,
  '{backspace}': fnDisplay.BACKSPACE,
  '{space}': fnDisplay.SPACE,
  '{language}': fnDisplay.LANGUAGE,
  '{numpad}': fnDisplay.NUMPAD,
  '{alphabetic}': 'АБВ',
  '{numeric}': '123',
  '{symbolic}': '#+=',
  '{abc}': 'АБВ',
};

const locale: Locale = {
  code: 'ru-RU',
  dir: 'ltr',
  layouts: layouts,
  display: display,
};

export default locale;
