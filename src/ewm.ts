import * as vscode from 'vscode';
import StatusDataI from './ewmStatusInterface';
import {EwmSandboxI} from './ewmSandboxInterface';
import { exec, ExecOptions } from 'child_process';

export class Ewm {
    public version: string = "0";

    constructor( private rootPath: vscode.Uri, private outputChannel: vscode.OutputChannel) {
    };

    private showError(message: string, error: any): void {
        vscode.window.showErrorMessage(`${message}: ${error.message || error}`);
        console.error(error);
    }

    /**
     * Executes an lscm command in the context of the current workspace.
     *
     * @param command - The lscm command to execute.
     * @returns A promise that resolves with the standard output of the command, or rejects with an error.
     *
     * @throws Will show an error message and reject the promise if the command execution fails or if there is any error output.
     */
    public async execLscm(command: string) : Promise<string> {
        let commandToExecute = `lscm ${command}`;
        this.outputChannel.appendLine(commandToExecute);
        const exOptions : ExecOptions = {cwd:this.rootPath.fsPath};

        return new Promise<string>((resolve, reject) => {
            exec(commandToExecute, exOptions ,(error, stdout, stderr) => {
                if (error) {
                    this.showError('Error running command', error);
                    reject(error);
                    return;
                }
                if (stderr) {
                    this.showError('Error output', stderr);
                    reject(new Error(stderr));
                    return;
                }
                resolve(stdout);
            });        
        });
    }

    /**
     * Retrieves the sandbox structure by executing the "show sandbox-structure -j" command.
     * Parses the command result as JSON and returns it.
     * 
     * @returns {Promise<EwmSandboxI | null>} A promise that resolves to the sandbox structure as an object, or null if an error occurs.
     * @throws Will show an error message and log the error to the console if the command execution or JSON parsing fails.
     */
    public async getSandbox() : Promise<EwmSandboxI | null> {
        let jsonSandbox: EwmSandboxI | null = null;

        try {
            const commandRes = await this.execLscm("show sandbox-structure -j");
            jsonSandbox = JSON.parse(commandRes.toString());
            
        } catch (error) {

            this.showError('Could not read file', error);
        }
        return jsonSandbox;
    }

    /**
     * Retrieves a file from the specified workspace and component, and writes it to the given output URI.
     *
     * @param sourceFile - The EWM repository path of the source file to retrieve.
     * @param component - The name of the component containing the file.
     * @param workspace - The name of the workspace containing the component.
     * @param outUri - The URI where the retrieved file should be written.
     * @returns A promise that resolves when the file has been successfully retrieved and written, or rejects with an error.
     *
     * @throws Will show an error message and reject the promise if the command execution fails.
     */
    public async getFile(sourceFile: string, component: string, workspace: string, outUri: vscode.Uri): Promise<void> {
        const fullCommand = `get file -w "${workspace}" -c "${component}" -f "${sourceFile}" ${outUri.fsPath}`;
        try {
            await this.execLscm(fullCommand);
            this.outputChannel.appendLine(`File retrieved: ${sourceFile}`);
        } catch (error) {
            this.showError('Could not retrieve file', error);
        }
    }

    /**
     * Retrieves the status of the workspaces by executing the `show status -j` command.
     * Parses the command result as JSON and checks if the "workspaces" property exists.
     * If "workspaces" exists, it logs the names of the workspaces and their components.
     * If "workspaces" does not exist, it logs a message indicating the absence of workspaces.
     * 
     * @returns {Promise<StatusDataI | null>} A promise that resolves to the status data or null if an error occurs.
     * @throws Will throw an error if the command execution or JSON parsing fails.
     */
    public async getStatus() : Promise<StatusDataI | null> {
        let retStatus = null;
        try {
            const commandRes = await this.execLscm(`show status -j`);
            const jsonStatus : StatusDataI = JSON.parse(commandRes.toString());

            // Check if "workspaces" is in the jsonStatus variable.
            if (jsonStatus.hasOwnProperty("workspaces")) {
                retStatus = jsonStatus;
                // Loop through all workspaces.
                for (const workspaceIndex in jsonStatus.workspaces) {
                    // Check if "incomming" is in the workspace.
                    if (jsonStatus.workspaces[workspaceIndex].hasOwnProperty("name")) {
                        const name = jsonStatus.workspaces[workspaceIndex].name;
                        this.outputChannel.appendLine("WorkSpaceName: " + name);
                    }

                    if (jsonStatus.workspaces[workspaceIndex].hasOwnProperty("components")) {
                        const components = jsonStatus.workspaces[workspaceIndex].components;
                        for (const componentIndex in components) {
                            if (components[componentIndex].hasOwnProperty("name")) {
                                const name = components[componentIndex].name;
                                this.outputChannel.appendLine("  ComponentName: " + name);
                            }
                        }
                    }
                }
            } else {
                this.outputChannel.appendLine("json has no workspaces");
            }

        } catch (e) {
            this.showError('Could not read file', e);
        }
        return retStatus;
    }
}
