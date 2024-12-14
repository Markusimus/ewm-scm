
import * as vscode from 'vscode';
import StatusDataI from './ewmStatusInterface';
import { exec } from 'child_process';

export class Ewm {
    public version: string = "0";
    private ewmPath: string = "pathtoewm";
    private outputChannel: vscode.OutputChannel;
    private rootPath: vscode.Uri | undefined;

    constructor( private context: vscode.ExtensionContext, private _outputChannel: vscode.OutputChannel) {
        this.outputChannel = _outputChannel;

        this.rootPath =
        vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri
            : undefined;
    };

    public async execLscm(command: String) : Promise<String> {
        
        // let returnVal = "";
        let commandToExecute = `lscm ${command} -d ${this.rootPath?.path}`;
        this.outputChannel.appendLine(commandToExecute);

        // exec(commandToExecute, (error, stdout, stderr) => {
        //     if (error) {
        //         vscode.window.showErrorMessage(`Error running command: ${error.message}`);
        //         return;
        //     }
        //     if(stderr){
        //         vscode.window.showErrorMessage(`Error output: ${stderr}`);
        //     }
        //     returnVal = stdout;
        //     //  vscode.window.showInformationMessage(`Command Output: ${stdout}`);
        // });

        // return returnVal;
        //We have to return an object with type of promise in order to use await inside of the function.
        //So we can wrap the "exec" into a new prmises so that we can wait for the value to be there before the function ends.
        return new Promise<string>((resolve, reject) => {
            exec(commandToExecute, (error, stdout, stderr) => {
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

    public async getStatus(filePathUri : vscode.Uri) : Promise<StatusDataI | null> {
        let retStatus = null;
        try {
            // const fileContent = await vscode.workspace.fs.readFile(filePathUri);
            const commandRes = await this.execLscm('show status -j');
            this.outputChannel.appendLine(commandRes.toString());
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