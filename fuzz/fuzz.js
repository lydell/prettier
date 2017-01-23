const chalk = require("chalk");
const codeFrame = require("babel-code-frame");
const jsdiff = require("diff");
const esfuzz = require("esfuzz");
const random = require("esfuzz/lib/random");
const fs = require("fs");
const kebabcase = require("lodash.kebabcase");
const minimist = require("minimist");
const shiftCodegen = require("shift-codegen");
const shiftFuzzer = require("shift-fuzzer");
const util = require("util");
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

function fuzzWithEsfuzz(maxDepth) {
  const randomAST = esfuzz.generate({ maxDepth });
  return esfuzz.render(randomAST);
}

function fuzzWithShiftFuzzer(maxDepth) {
  const randomAST = shiftFuzzer.fuzzModule(new shiftFuzzer.FuzzerState({
    maxDepth
  }));
  const generator = random.randomElement([
    shiftCodegen.MinimalCodeGen,
    shiftCodegen.FormattedCodeGen
  ]);
  return shiftCodegen.default(randomAST, new generator());
}

function formatError(num, error) {
  return [
    "prettier.format " + num + " error:",
    error && error.stack
      ? error.stack
      : util.inspect(error, { depth: 10, colors: true })
  ].join("\n");
}

const argv = minimist(process.argv.slice(2), {
  boolean: [ "show-initial-parse-errors", "show-successes", "reproduce" ],
  string: [ "fuzzer", "max-depth" ],
  default: {
    // "esfuzz" or "shift"
    fuzzer: "shift",
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

const maxDepth = parseInt(argv["max-depth"], 10);
const fuzzer = argv["fuzzer"] === "shift"
  ? fuzzWithShiftFuzzer
  : fuzzWithEsfuzz;

let tryCount = 0;
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
  randomJS = argv["reproduce"]
    ? fs.readFileSync(__dirname + "/random.js", "utf-8")
    : fuzzer(maxDepth);

  if (!argv["reproduce"] && boringRegex.test(randomJS)) {
    continue;
  }

  options = randomOptions();
  options = require("./options.json");

  try {
    prettierJS1 = prettier.format(randomJS, options);
  } catch (error) {
    if (
      !argv["reproduce"] &&
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
  if (hasError || hasDiff || argv["show-successes"] || argv["reproduce"]) {
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
  " " +
  (tryCount === 1 ? "try" : "tries") +
  ". " +
  (argv["reproduce"]
    ? "Reproduced with `--reproduce`. You can also play with:\n"
    : "Add `--reproduce` to reproduce, or play with:\n");

const reproductionCommand = "./bin/prettier.js fuzz/random.js " +
  Object
    .keys(options)
    .map(key => "--" + kebabcase(key) + "=" + options[key])
    .join(" ");

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
  message,
  reproductionCommand
]
  .filter(part => part !== null)
  .join("\n");

console.log(output);

if (!argv["reproduce"]) {
  fs.writeFileSync(__dirname + "/random.js", randomJS);
  fs.writeFileSync(__dirname + "/random.backup.js", randomJS);
  fs.writeFileSync(__dirname + "/options.json", optionsString);
}

fs.writeFileSync(__dirname + "/prettier1.js", prettierJS1 || "<error>");
fs.writeFileSync(__dirname + "/prettier2.js", prettierJS2 || "<error>");
