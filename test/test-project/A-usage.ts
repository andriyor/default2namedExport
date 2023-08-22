import ComponentNameRenamed from './B-method';
import ButtonRenamed from './src/components/main';
import { Image } from './src/components/main';
import { VideoRenamed } from './src/components/main';
import Input, { inputFormat } from './src/components/main/Input';
import TextRenamed from './src/components/main/Text';
const UsedRequire = require('./src/components/main/UsedRequire').default;

console.log(ComponentNameRenamed());
console.log(ButtonRenamed());
console.log(Input());
console.log(Image());
console.log(VideoRenamed());
console.log(inputFormat());
console.log(TextRenamed());
console.log(UsedRequire());
