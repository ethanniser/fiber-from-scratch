let x = 0;

async function foo() {
  console.log(`foo start: ${x}`);
  await new Promise((resolve) => resolve());
  console.log(`foo end: ${x}`);
}

function bar() {
  console.log(`bar start: ${x}`);
  x++;
  console.log(`bar end: ${x}`);
}

foo();
bar();
