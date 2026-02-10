import getOptionsURL from '../misc/getOptionsURL.js';
import english from './tr/english.js';
import chinese from './tr/chinese.js';
import japanese from './tr/japanese.js';
import korean from './tr/korean.js';
import russian from './tr/russian.js';
import turkish from './tr/turkish.js';
import swedish from './tr/swedish.js';
import french from './tr/french.js';
import german from './tr/german.js';
import italian from './tr/italian.js';

var GuiTR = function (key) {
  var str = GuiTR.languages[GuiTR.select][key] || GuiTR.languages.english[key];
  if (typeof str === 'string')
    return str;
  if (typeof str === 'function')
    return str.apply(this, Array.prototype.slice.call(arguments, 1));
  console.error('No TR found for : ' + key);
  return key;
};

GuiTR.languages = {
  'english': english,
  '日本語': japanese,
  '中文': chinese,
  '한국어': korean,
  'русский': russian,
  'turkish': turkish,
  'svenska': swedish,
  'français': french,
  'deutsch': german,
  'italiano': italian
};

GuiTR.select = 'english';
var language = window.navigator.language || window.navigator.userLanguage;
if (language) language = language.substr(0, 2);
if (language === 'ja') GuiTR.select = '日本語';
else if (language === 'zh') GuiTR.select = '中文';
else if (language === 'ko') GuiTR.select = '한국어';
else if (language === 'tr') GuiTR.select = 'turkish';
else if (language === 'sv') GuiTR.select = 'svenska';
else if (language === 'fr') GuiTR.select = 'français';
else if (language === 'de') GuiTR.select = 'deutsch';

switch (getOptionsURL().language) {
case 'english':
  GuiTR.select = 'english';
  break;
case 'chinese':
  GuiTR.select = '中文';
  break;
case 'korean':
  GuiTR.select = '한국어';
  break;
case 'japanese':
  GuiTR.select = '日本語';
  break;
case 'russian':
  GuiTR.select = 'русский';
  break;
case 'turkish':
  GuiTR.select = 'turkish';
  break;
case 'swedish':
  GuiTR.select = 'svenska';
  break;
case 'french':
  GuiTR.select = 'français';
  break;
case 'german':
  GuiTR.select = 'deutsch';
  break;
case 'italian':
  GuiTR.select = 'italiano';
  break;
}

export default GuiTR;
