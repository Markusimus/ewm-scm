import { Ewm } from './ewm';
import { Uri, TextDocumentContentProvider, EventEmitter, Event, Disposable, CancellationToken, ProviderResult } from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto'; // Import the Node.js crypto module
import * as os from 'os';
import { OriginalResourceChangeEvent, Model } from './model';
import { EWM_SCHEME } from './ewmSourceControl';

/**
 * Provides the content of the JS Fiddle documents as fetched from the server i.e.  without the local edits.
 * This is used for the source control diff.
 */
export class EwmDocumentContentProvider implements TextDocumentContentProvider, Disposable {
    private _onDidChange = new EventEmitter<Uri>();
    private loadedFiles = new Map<string, string>();
    disposables: Disposable[] = [];

    constructor(private ewm: Ewm, private model: Model) {
        this.disposables.push(
			// model.onDidChangeRepository(this.onDidChangeRepository, this),
			model.onDidChangeOriginalResource(this.onDidChangeOriginalResource, this)
			// workspace.registerFileSystemProvider('git', this, { isReadonly: true, isCaseSensitive: true }),
		);
    }

    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    dispose(): void {
        this._onDidChange.dispose();
    }

    private onDidChangeOriginalResource({ uri }: OriginalResourceChangeEvent): void {
		// if (uri.scheme !== EWM_SCHEME) {
		// 	return;
		// }

        // Remove the uri.path from the loadedFiles.
        this.loadedFiles.delete(uri.path);
        this._onDidChange.fire(uri);
	}

    provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string> {
        if (token.isCancellationRequested) { return "Canceled"; }

        let relativeUri = uri.path;

        // Check if uri is already present in the loadedFiles.
        // If so then return the tempUri.If not then get file from ewm and store it in system tempdir.
        const documentContent = this.loadedFiles.get(relativeUri);
        if (documentContent) {
            console.log(`provideTextDocumentContent using the already loaded file: ${relativeUri}`);
            return documentContent;
        }

        this.getOriginalData(uri);

        // TODO: Return the content of the local file.
        // const localFileContent = fs.readFileSync(uri.fsPath, 'utf-8');
        return "";
        // return "Downloading file...";
    }

    // get original data fro the repository
    async getOriginalData(uri: Uri): Promise<string> {

        let relativeUri = uri.path;

        const workspaceName = relativeUri.split('/')[1];
        const componentName = relativeUri.split('/')[2];
        const docUri = relativeUri.substring( workspaceName.length + componentName.length + 2 );

        // Get Temporary directory of the operating system.
        const systemTempDir = Uri.file(os.tmpdir());
        const tempFileName = crypto.randomBytes(16).toString("hex");
        let tempFileUri = Uri.joinPath(systemTempDir, tempFileName);
        console.log(`doc uri: ${docUri}  componentName: ${componentName} workspaceName: ${workspaceName}`);

        const success = await this.ewm.getFile(docUri, componentName, workspaceName, tempFileUri)
        if (success) {
            if (!fs.existsSync(tempFileUri.fsPath)) {
                console.error(`Resource not found: ${tempFileUri.fsPath}:`);
                return "";
            }

            // Open and read content of the file
            const fileContent = fs.readFileSync(tempFileUri.fsPath, 'utf-8');
            this.loadedFiles.set(relativeUri, fileContent);
            // Remove the temp file after reading the content.
            fs.unlinkSync(tempFileUri.fsPath);
            this._onDidChange.fire(uri);
            
        }
        else {
            if (!fs.existsSync(uri.fsPath)) {
                console.error(`Resource not found: ${tempFileUri.fsPath}:`);
                return "";
            }
            const localFileContent = fs.readFileSync(uri.fsPath, 'utf-8');
            this.loadedFiles.set(relativeUri, localFileContent);
            this._onDidChange.fire( Uri.file(relativeUri) );
        }

        return "";
        
    }
}
