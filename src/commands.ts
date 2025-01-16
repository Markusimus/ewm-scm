
import { Ewm } from "./ewm";
import { Model } from "./model";
import { OutputChannel, commands, Disposable, workspace, Memento, SourceControlResourceState } from "vscode";
import { EwmRepository as Repository, Resource } from "./ewmSourceControl";

interface ScmCommandOptions {
	repository?: boolean;
	diff?: boolean;
}

interface ScmCommand {
	commandId: string;
	key: string;
	method: Function;
	options: ScmCommandOptions;
}

const Commands: ScmCommand[] = [];

function command(commandId: string, options: ScmCommandOptions = {}): Function {
	return (_target: any, key: string, descriptor: any) => {
		if (!(typeof descriptor.value === 'function')) {
			throw new Error('not supported');
		}

		Commands.push({ commandId, key, method: descriptor.value, options });
	};
}

export class CommandCenter {

	private disposables: Disposable[];
	// private commandErrors = new CommandErrorOutputTextDocumentContentProvider();

	constructor(
		private ewm: Ewm,
		private model: Model,
		private globalState: Memento,
		private logger: OutputChannel,
		// private telemetryReporter: TelemetryReporter
	) {
		this.disposables = Commands.map(({ commandId, key, method, options }) => {
			const command = this.createCommand(commandId, key, method, options);
            return commands.registerCommand(commandId, command);

			// if (options.diff) {
            //     return;
			// 	return commands.registerDiffInformationCommand(commandId, command);
			// } else {
			// 	return commands.registerCommand(commandId, command);
			// }
		});

		// this.disposables.push(workspace.registerTextDocumentContentProvider('git-output', this.commandErrors));
	}

	@command('ewm-scm.ewmInit')
	async ewmInit(): Promise<void> {
		await this.model.initEwm();
	}

	@command('ewm-scm.showOutput')
	showOutput(): void {
		this.logger.show();
	}

    @command('ewm-scm.refresh', { repository: true })
	async refresh(repository: Repository): Promise<void> {
		await repository.refresh();
	}

	@command('ewm-scm.checkin')
	async stage(...resourceStates: Resource[]): Promise<void> {
		this.logger.appendLine(`[CommandCenter][checkin] ewm-scm.stage ${resourceStates.length} `);

		if (resourceStates.length > 0)
		{
			const repository = this.model.getRepository(resourceStates[0]);
			if (repository){
				await repository.checkin(resourceStates);
			}	
		}
	}

	@command('ewm-scm.open')
	async open(...resourceStates: Resource[]): Promise<void> {
		this.logger.appendLine(`[CommandCenter][open] ewm-scm.open ${resourceStates.length} `);

		if (resourceStates.length > 0)
		{
			// Open the file in vscode for all resourceStates
			for (const resource of resourceStates) {
				if (resource.leftUri){
					commands.executeCommand('vscode.open', resource.leftUri);
				}
			}

		}
	}

    private createCommand(id: string, key: string, method: Function, options: ScmCommandOptions): (...args: any[]) => any {
		const result = (...args: any[]) => {
			let result: Promise<any>;

			if (!options.repository) {
				result = Promise.resolve(method.apply(this, args));
			} else {
				// try to guess the repository based on the first argument
				const repository = this.model.getRepository(args[0]);
				let repositoryPromise: Promise<Repository | undefined>;

				if (repository) {
					repositoryPromise = Promise.resolve(repository);
				} else if (this.model.repositories.length === 1) {
					repositoryPromise = Promise.resolve(this.model.repositories[0]);
				} else {
					repositoryPromise = this.model.pickRepository();
				}

				result = repositoryPromise.then(repository => {
					if (!repository) {
						return Promise.resolve();
					}

					return Promise.resolve(method.apply(this, [repository, ...args.slice(1)]));
				});
			}

			return result.catch(err => {
                this.logger.appendLine("Error");
				// const options: MessageOptions = {
				// 	modal: true
				// };

				// let message: string;
				// let type: 'error' | 'warning' | 'information' = 'error';

				// const choices = new Map<string, () => void>();
				// const openOutputChannelChoice = l10n.t('Open Git Log');
				// const outputChannelLogger = this.logger;
				// choices.set(openOutputChannelChoice, () => outputChannelLogger.show());

				// const showCommandOutputChoice = l10n.t('Show Command Output');
				// if (err.stderr) {
				// 	choices.set(showCommandOutputChoice, async () => {
				// 		const timestamp = new Date().getTime();
				// 		const uri = Uri.parse(`git-output:/git-error-${timestamp}`);

				// 		let command = 'git';

				// 		if (err.gitArgs) {
				// 			command = `${command} ${err.gitArgs.join(' ')}`;
				// 		} else if (err.gitCommand) {
				// 			command = `${command} ${err.gitCommand}`;
				// 		}

				// 		this.commandErrors.set(uri, `> ${command}\n${err.stderr}`);

				// 		try {
				// 			const doc = await workspace.openTextDocument(uri);
				// 			await window.showTextDocument(doc);
				// 		} finally {
				// 			this.commandErrors.delete(uri);
				// 		}
				// 	});
				// }

				// switch (err.gitErrorCode) {
				// 	case GitErrorCodes.DirtyWorkTree:
				// 		message = l10n.t('Please clean your repository working tree before checkout.');
				// 		break;
				// 	case GitErrorCodes.PushRejected:
				// 		message = l10n.t('Can\'t push refs to remote. Try running "Pull" first to integrate your changes.');
				// 		break;
				// 	case GitErrorCodes.ForcePushWithLeaseRejected:
				// 	case GitErrorCodes.ForcePushWithLeaseIfIncludesRejected:
				// 		message = l10n.t('Can\'t force push refs to remote. The tip of the remote-tracking branch has been updated since the last checkout. Try running "Pull" first to pull the latest changes from the remote branch first.');
				// 		break;
				// 	case GitErrorCodes.Conflict:
				// 		message = l10n.t('There are merge conflicts. Please resolve them before committing your changes.');
				// 		type = 'warning';
				// 		choices.clear();
				// 		choices.set(l10n.t('Show Changes'), () => commands.executeCommand('workbench.view.scm'));
				// 		options.modal = false;
				// 		break;
				// 	case GitErrorCodes.StashConflict:
				// 		message = l10n.t('There are merge conflicts while applying the stash. Please resolve them before committing your changes.');
				// 		type = 'warning';
				// 		choices.clear();
				// 		choices.set(l10n.t('Show Changes'), () => commands.executeCommand('workbench.view.scm'));
				// 		options.modal = false;
				// 		break;
				// 	case GitErrorCodes.AuthenticationFailed: {
				// 		const regex = /Authentication failed for '(.*)'/i;
				// 		const match = regex.exec(err.stderr || String(err));

				// 		message = match
				// 			? l10n.t('Failed to authenticate to git remote:\n\n{0}', match[1])
				// 			: l10n.t('Failed to authenticate to git remote.');
				// 		break;
				// 	}
				// 	case GitErrorCodes.NoUserNameConfigured:
				// 	case GitErrorCodes.NoUserEmailConfigured:
				// 		message = l10n.t('Make sure you configure your "user.name" and "user.email" in git.');
				// 		choices.set(l10n.t('Learn More'), () => commands.executeCommand('vscode.open', Uri.parse('https://aka.ms/vscode-setup-git')));
				// 		break;
				// 	case GitErrorCodes.EmptyCommitMessage:
				// 		message = l10n.t('Commit operation was cancelled due to empty commit message.');
				// 		choices.clear();
				// 		type = 'information';
				// 		options.modal = false;
				// 		break;
				// 	case GitErrorCodes.CherryPickEmpty:
				// 		message = l10n.t('The changes are already present in the current branch.');
				// 		choices.clear();
				// 		type = 'information';
				// 		options.modal = false;
				// 		break;
				// 	case GitErrorCodes.CherryPickConflict:
				// 		message = l10n.t('There were merge conflicts while cherry picking the changes. Resolve the conflicts before committing them.');
				// 		type = 'warning';
				// 		choices.set(l10n.t('Show Changes'), () => commands.executeCommand('workbench.view.scm'));
				// 		options.modal = false;
				// 		break;
				// 	default: {
				// 		const hint = (err.stderr || err.message || String(err))
				// 			.replace(/^error: /mi, '')
				// 			.replace(/^> husky.*$/mi, '')
				// 			.split(/[\r\n]/)
				// 			.filter((line: string) => !!line)
				// 		[0];

				// 		message = hint
				// 			? l10n.t('Git: {0}', hint)
				// 			: l10n.t('Git error');

				// 		break;
				// 	}
				// }

				// if (!message) {
				// 	console.error(err);
				// 	return;
				// }

				// // We explicitly do not await this promise, because we do not
				// // want the command execution to be stuck waiting for the user
				// // to take action on the notification.
				// this.showErrorNotification(type, message, options, choices);
			});
		};

		// patch this object, so people can call methods directly
		(this as any)[key] = result;

		return result;
	}

    dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}