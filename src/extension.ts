'use strict';
import {
    window, workspace,
    ExtensionContext,
    Range, Position,
    TextDocument, TextEditor,
    TextEditorDecorationType, DecorationOptions
} from 'vscode';

import * as esprima from 'esprima';
import * as eslevels from 'eslevels';
import { flow, compact, includes, groupBy, flatMap } from 'lodash';

type Level = [number, number, number]; // [level, x1, x2]

interface DecorationArgs {
    type: TextEditorDecorationType;
    options: DecorationOptions[];
}

const blacklist = ['function'];

export function activate(context: ExtensionContext) {
    const apply = applyLevels(context);
    window.visibleTextEditors.forEach(apply);
    workspace.onDidChangeTextDocument(event => {
        if (window.activeTextEditor.document === event.document) {
            apply(window.activeTextEditor);
        }
    }, null, context.subscriptions);
    workspace.onDidChangeConfiguration(() => {
        apply(window.activeTextEditor);
    }, null, context.subscriptions);
    window.onDidChangeActiveTextEditor(apply, null, context.subscriptions);
}

const levelToLevelDecoration = ([level]: Level) =>
    window.createTextEditorDecorationType({
        color: getColors()[level + 1],
    });

const levelToRange = (textEditor: TextEditor, [l, x1, x2]: Level) =>
    textEditor.document.validateRange(new Range(
        textEditor.document.positionAt(x1),
        textEditor.document.positionAt(x2 + 1),
    ));

const getTextFromEditor = (textEditor: TextEditor) =>
    textEditor.document.getText();

const sourceCodeToAst = (code: string) =>
    esprima.parse(code, { range: true });

const astToLevels = (ast): Level[] =>
    eslevels.levels(ast, { mode: 'mini' });

const getLevelsForEditor = flow(
    getTextFromEditor, sourceCodeToAst, astToLevels
);

const getDecorationsForLevels = (textEditor: TextEditor, levels: Level[]) =>
    levels.map(level => ({ level, range: levelToRange(textEditor, level) }))
    .filter(({ range }) =>
        !includes(blacklist, textEditor.document.getText(range))
    );

const getHoverMessage = ([level]: Level) => {
    if (level < 0) return '[levels] Implicit global scope';
    if (level === 0) return '[levels] Global scope';
    return  `[levels] Scope level ${level}`;
}

function applyLevels(context: ExtensionContext) {
    return function apply(textEditor: TextEditor) {
        const levels = getLevelsForEditor(textEditor);
        const decorations = getDecorationsForLevels(textEditor, levels);

        const groups = groupBy(decorations, ({ level }) => level[0]);

        const args = flatMap(groups, group => {
            const { level } = group[0];
            return {
                type: levelToLevelDecoration(level),
                options: group.map(({ range }) => ({
                    range, hoverMessage: getHoverMessage(level)
                }))
            }
        });

        clearDecorations();
        args.forEach(setDecoration);
        storeDecorations(args.map(arg => arg.type));

        function clearDecorations() {
            context.workspaceState
                .get<TextEditorDecorationType[]>('types', [])
                .forEach((type) => {
                    setDecoration({ type, options: [] });
                });
        }

        function setDecoration({ options, type }: DecorationArgs) {
            textEditor.setDecorations(type, options);
        }

        function storeDecorations(types: TextEditorDecorationType[]) {
            context.workspaceState.update('types', types);
        }
    }
}

function getColors() {
    return workspace.getConfiguration('levels').get('colors');
}
