# ewm-sc README

The IBM Engineering Workflow Manager (EWM) source control extension for VS Code.

## Features

This extension dispalys incomming, outgoing, and unresolve file changes.
It implements original file for Diff and quick diff.

## Requirements

The jazz lscm needs to be installed and accesable in PATH.
The lscm needs to be logged in to EWM using following command:
    lscm login -r <https://repository_url> -u <username> -c

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `ewm-scm.enable`: Enable/disable this extension.


## Known Issues

This extension is early stage of development.
Many issues and unfinished functions are expected.
The settings are not fully implemented yet.

## Release Notes

### 0.0.8
Added Checkin command for Unresolved files.
Added Open Repository command.

### 0.0.3
Initial development release that works in MacOS and Windows.

