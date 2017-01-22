const chalk = require("chalk");
const codeFrame = require("babel-code-frame");
const jsdiff = require("diff");
const esfuzz = require("esfuzz");
const random = require("esfuzz/lib/random");
const fs = require("fs");
const minimist = require("minimist");
const prettier = require("../");

function randomOptions() {
  return {
    printWidth: random.randomInt(200),
    tabWidth: random.randomInt(12),
    singleQuote: random.randomBool(),
    trailingComma: random.randomBool(),
    bracketSpacing: random.randomBool(),
    parser: random.randomElement([ "babylon", "flow" ])
  };
}

function colorizeDiff(part) {
  const color = part.added
    ? chalk.bgGreen
    : part.removed ? chalk.bgRed : chalk.grey;
  const value = part.value;
  return value === "\n" ? color(" ") + "\n" : color(value);
}

function highlight(text) {
  return codeFrame(text, null, null, {
    highlightCode: true,
    linesBelow: Infinity
  });
}

function formatError(num, error) {
  return [ "prettier.format " + num + " error:", error && error.stack ].join(
    "\n"
  );
}

const argv = minimist(process.argv.slice(2), {
  boolean: [ "show-initial-parse-errors", "show-successes" ],
  string: [ "max-depth" ],
  default: {
    "max-depth": "7",
    "show-initial-parse-errors": false,
    "show-successes": false
  },
  unknown: param => {
    if (param.startsWith("-")) {
      console.warn("Ignored unknown option: " + param + "\n");
    }
  }
});

const boringRegex = /^[\s;]*$|with/;

let tryCount = 0;
let randomAST;
let randomJS;
let options;
let prettierJS1;
let prettierJS1Error;
let prettierJS2;
let prettierJS2Error;
let hasError = false;
let hasDiff = false;

while (true) {
  tryCount++;
  randomAST = esfuzz.generate({ maxDepth: parseInt(argv["max-depth"], 10) });
  randomJS = esfuzz.render(randomAST);

  if (boringRegex.test(randomJS)) {
    continue;
  }

  options = randomOptions();

  try {
    prettierJS1 = prettier.format(randomJS, options);
  } catch (error) {
    if (
      !argv["show-initial-parse-errors"] &&
        error.toString().includes("SyntaxError")
    ) {
      continue;
    }
    prettierJS1Error = error;
  }

  if (!prettierJS1Error) {
    try {
      prettierJS2 = prettier.format(prettierJS1, options);
    } catch (error) {
      prettierJS2Error = error;
    }
  }

  hasError = Boolean(prettierJS1Error || prettierJS2Error);
  hasDiff = !hasError && prettierJS1 !== prettierJS2;
  if (hasError || hasDiff || argv["show-successes"]) {
    break;
  }
}

const diffString = hasDiff
  ? jsdiff.diffChars(prettierJS1, prettierJS2).map(colorizeDiff).join("")
  : "";

const optionsString = JSON.stringify(options, null, 2);

const status = hasDiff
  ? chalk.red("Diff")
  : hasError ? chalk.red("Error") : chalk.green("Success");

const message = status +
  " after " +
  tryCount +
  (tryCount === 1 ? "try" : " tries");

const separator = "─".repeat(process.stdout.columns);

const output = [
  highlight(randomJS),
  separator,
  hasDiff || hasError ? diffString : highlight(prettierJS1),
  prettierJS1Error ? formatError(1, prettierJS1Error) : null,
  prettierJS2Error ? formatError(2, prettierJS2Error) : null,
  separator,
  optionsString,
  separator,
  message
]
  .filter(part => part !== null)
  .join("\n");

console.log(output);

fs.writeFileSync(__dirname + "/random.js", randomJS);
fs.writeFileSync(__dirname + "/prettier1.js", prettierJS1);
fs.writeFileSync(__dirname + "/prettier2.js", prettierJS2);
fs.writeFileSync(__dirname + "/options.json", optionsString);
