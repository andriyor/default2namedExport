import helper from '../../helper/helper';
import User from '../../types/basic';

export const inputFormat = () => 'import format';

const Input = () => {
  helper();
  const user: User = {
    firstName: 'Bob',
    lastName: 'Dilan',
  };
  console.log(user);
  return 'input';
};

export default Input;
