import * as vscode from 'vscode';
import StatusDataI from './ewmStatusInterface';
import {EwmSandboxI} from './ewmSandboxInterface';
import { exec, ExecOptions } from 'child_process';

export class Ewm {
    public version: string = "0";

    constructor( private rootPath: vscode.Uri, private outputChannel: vscode.OutputChannel) {
    };

    

    public async execLscm(command: String) : Promise<String> {
        
        // let returnVal = "";
        let commandToExecute = `lscm ${command}`;
        this.outputChannel.appendLine(commandToExecute);
        const exOptions : ExecOptions = {cwd:this.rootPath?.fsPath};

        // return returnVal;
        //We have to return an object with type of promise in order to use await inside of the function.
        //So we can wrap the "exec" into a new prmises so that we can wait for the value to be there before the function ends.
        return new Promise<string>((resolve, reject) => {
            exec(commandToExecute, exOptions ,(error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage(`Error running command: ${error.message}`);
                    reject(error);
                    return;
                }
                if(stderr){
                    vscode.window.showErrorMessage(`Error output: ${stderr}`);
                    reject(stderr);
                    return;
                }
                resolve(stdout);
            });        
        });
    };

    // public async getSandbox() : Promise<EwmSandboxI | null> {

    //     const commandRes = await this.execLscm("show sandbox-structure -j");
    //     const jsonSandbox : EwmSandboxI = JSON.parse(commandRes.toString());
    //     this.sandBoxPath = vscode.Uri.file(jsonSandbox.sandbox);
    //     return jsonSandbox;
    // }

    public async getFile(sourceFile: string, component: string, workspace: string, outUri: vscode.Uri): Promise<void> {
        // lscm get file -w VSCodeWork -c ScriptComponent -f /testDir/testfile.txt ../../../testfileLoad1.txt
        let fullCommand = `get file -w "${workspace}" -c "${component}" -f "${sourceFile}" ${outUri.fsPath}`;
        await this.execLscm(fullCommand);
    }

    public async getStatus() : Promise<StatusDataI | null> {
        let retStatus = null;
        try {
            // const fileContent = await vscode.workspace.fs.readFile(filePathUri);
            const commandRes = await this.execLscm(`show status -j`);
            // this.outputChannel.appendLine(commandRes.toString());
            const jsonStatus : StatusDataI = JSON.parse(commandRes.toString());

            // const jsonStatus : StatusDataI = JSON.parse(fileContent.toString());

            // Check if "workspaces" is in the jsonStatus variable.
            if (jsonStatus.hasOwnProperty("workspaces")) {
                retStatus = jsonStatus;
                // Loop through all workspaces.
                for (const workspaceIndex in jsonStatus.workspaces) {
                    // Check if "incomming" is in the workspace.
                    if (jsonStatus.workspaces[workspaceIndex].hasOwnProperty("name")) {
                        const name = jsonStatus.workspaces[workspaceIndex].name;
                        // console.log("WorkSpaceName: " + name);
                        this.outputChannel.appendLine("WorkSpaceName: " + name);
                    }

                    if (jsonStatus.workspaces[workspaceIndex].hasOwnProperty("components")) {
                        const components = jsonStatus.workspaces[workspaceIndex].components;
                        for (const componentIndex in components) {
                            if (components[componentIndex].hasOwnProperty("name")) {
                                const name = components[componentIndex].name;
                                // console.log("  ComponentName: " + name);
                                this.outputChannel.appendLine("  ComponentName: " + name);
                            }
                        }
                    }
                }
            } else {
                this.outputChannel.appendLine("json has no workspaces");
                // console.log("json has no workspaces");
            }

        } catch (e) {
            vscode.window.showErrorMessage('Could not read file: ' + e);
            console.error(e);
        }
        return retStatus;
    
    }
}