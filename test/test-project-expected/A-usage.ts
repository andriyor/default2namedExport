import dynamic from 'next/dynamic';

import { ComponentName } from './B-method';
import ButtonRenamed from './src/components/main';
import { Image } from './src/components/main';
import { Video } from './src/components/main';
import { inputFormat, Input } from './src/components/main/Input';
import { TextComponent } from './src/components/main/Text';
const UsedRequire = require('./src/components/main/UsedRequire').default;

dynamic(() => import('./src/components/main/DynamicMusic'));

console.log(ComponentName());
console.log(ButtonRenamed());
console.log(Input());
console.log(Image());
console.log(Video());
console.log(inputFormat());
console.log(TextComponent());
console.log(UsedRequire());
