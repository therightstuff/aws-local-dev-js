const aws = require(`aws-sdk`);
const cp = require("child_process");
const fs = require("fs");
const yaml = require('js-yaml')

let functions = {};

function stripUnusedChars(str) {
    str = str.replace("-", "");
    str = str.replace("_", "");
    return str;
}

const exportable = {
    commandList: [],
    command: (command, next) => {
        next = next || (() => {});
        if (exportable.commandList.indexOf(command) > -1) {
            // https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-local-invoke.html
            // 1. list available test event objects
            //      eg ddb get, ddb post
            // 2. logs to stdout by default
            // 3. always add test/env.json
            // 4. layers
            // TODO command will include name and sample request file if any
            // name => functions[name].Properties.FunctionName
            // lambda simple-function -> sam local invoke simplefunctionD9727239 --env-vars test/env.json --debug --log-file logs
        }
        console.log('NOT IMPLEMENTED');
        next();
    },
    init: (stack) => {
        console.log("retrieving function names");
        for (let i in stack.node.children) {
            let child = stack.node.children[i];
            if (child.functionName) {
                let key = child.node._actualNode.id;
                functions[key] = {};
                exportable.commandList.push(key);
            }
        }

        console.log("retrieving function definitions...");
        let template = yaml.safeLoadAll(fs.readFileSync('template.yaml'));
        for (let key in template[0].Resources) {
            for (let functionName in functions) {
                let strippedName = stripUnusedChars(functionName);
                let strippedKey = key.substr(0, key.length - 8);
                if (strippedKey == strippedName) {
                    functions[functionName] = template[0].Resources[key];
                    functions[functionName].Properties.FunctionName = key;
                    console.log(functions[functionName]);
                }
            }
        }

        console.log("transforming test/env.json.template...");
        let envs = JSON.parse(fs.readFileSync("./test/env.template.json"));
        // before processing envs, add any functions that haven't been explicitly references
        for (name in functions) {
            if (!envs[name]) {
                envs[name] = {};
            }
        }
        for (name in envs) {
            // add AWS_LOCAL_DEV: "true" to environment variables
            envs[name].AWS_LOCAL_DEV = "true";
            // rename key to generated function name
            envs[functions[name].Properties.FunctionName] = envs[name];
            delete envs[name];
        }
        fs.writeFileSync("./test/env.json", JSON.stringify(envs));
    } // init
};

module.exports = exportable;