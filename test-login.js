const bcrypt = require('bcrypt');

async function test() {
  const password = 'password123';
  const rounds = 10;
  
  console.log('Hashing password with 10 rounds...');
  const hashed = await bcrypt.hash(password, rounds);
  console.log('Hashed:', hashed);
  
  console.log('\nTesting comparison...');
  const isValid = await bcrypt.compare(password, hashed);
  console.log('Password valid:', isValid);
  
  console.log('\nTesting with wrong password...');
  const isInvalid = await bcrypt.compare('wrongpassword', hashed);
  console.log('Wrong password valid:', isInvalid);
}

test().catch(console.error);
