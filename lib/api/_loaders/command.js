const EventEmitter = require('events');
const BaseCommandLoader = require('./_command-loader.js');
const {Logger, isES6AsyncFn, isFunction, isObject, makePromise} = require('../../utils');

class CommandLoader extends BaseCommandLoader {

  static get interfaceMethods() {
    return {
      command: 'function'
    };
  }

  static isDeprecatedCommandStyle(CommandModule) {
    return isObject(CommandModule) && isFunction(CommandModule.command);
  }

  /**
   * This is to support backwards-compatibility for commands defined as objects,
   *  with a command() property
   *
   * @param CommandModule
   */
  static createFromObject(CommandModule) {
    return class CommandClass extends EventEmitter {
      command(...args) {
        if (isES6AsyncFn(CommandModule.command)) {
          return CommandModule.command.apply(this.api, args);
        }

        setImmediate(() => {
          CommandModule.command.apply(this.api, args);
        });

        return this.api;
      }
    };
  }

  static transportActions({actions, api}) {
    return new Proxy(actions, {
      get(target, name) {
        return function(...args) {
          let callback;
          let method;
          const isLastArgFunction = isFunction(args[args.length - 1]);

          if (isLastArgFunction) {
            callback = args.pop();
          } else if (args.length === 0 || !isLastArgFunction) {
            callback = function(result) {return result};
          }

          const definition = {
            args
          };

          if (name in target.session) { // actions that require the current session
            method = target.session[name];
            definition.sessionId = api.sessionId;
          } else {
            method = target[name];
          }

          return method(definition).then((result) => makePromise(callback, api, [result]));
        };
      }
    });
  }

  static createInstance(nightwatchInstance, CommandModule, opts) {
    const CommandClass = CommandLoader.isDeprecatedCommandStyle(CommandModule) ? CommandLoader.createFromObject(CommandModule) : CommandModule;

    class CommandInstance extends CommandClass {
      reportProtocolErrors(result) {
        if (opts.isUserDefined) {
          return true;
        }

        return super.reportProtocolErrors(result);
      }

      get api() {
        return nightwatchInstance.api;
      }

      get reuseBrowser() {
        return nightwatchInstance.argv['reuse-browser'] || (nightwatchInstance.settings.globals && nightwatchInstance.settings.globals.reuseBrowserSession);
      }

      get isES6AsyncCommand() {
        return isES6AsyncFn(
          CommandLoader.isDeprecatedCommandStyle(CommandModule) ? CommandModule.command : this.command
        );
      }

      get client() {
        return this.__nightwatchInstance || nightwatchInstance;
      }

      get commandFileName() {
        return opts.commandName;
      }

      get commandArgs() {
        return opts.args;
      }

      get transportActions() {
        return this.client.transportActions;
      }

      get driver() {
        return this.client.transport.driver;
      }

      httpRequest(requestOptions) {
        return this.client.transport.runProtocolAction(requestOptions);
      }

      toString() {
        return `${this.constructor.name} [name=${opts.commandName}]`;
      }

      complete(...args) {
        if (isFunction(super.complete)) {
          return super.complete(...args);
        }

        this.emit('complete', ...args);
      }
    }

    const instance = new CommandInstance();

    Object.keys(CommandLoader.interfaceMethods).forEach(method => {
      const type = CommandLoader.interfaceMethods[method];
      if (!BaseCommandLoader.isTypeImplemented(instance, method, type)) {
        throw new Error(`Command class must implement method .${method}()`);
      }
    });

    instance.stackTrace = opts.stackTrace;
    instance.needsPromise = CommandLoader.isDeprecatedCommandStyle(CommandModule);

    return instance;
  }

  get loadSubDirectories() {
    return true;
  }

  createWrapper() {
    if (this.module) {
      // this place is only reached by client-commands, protocol commands and custom-commands (no assertions or element-commands).
      if (this.isUserDefined) {
        // only custom-commands will reach here.
        // later extend this to client-commands and protocol commands as well.
        Object.defineProperty(this.module, 'rejectNodeOnAbortFailure', {
          configurable: true,
          get() {
            return true;
          }
        });
      }

      this.commandFn = function commandFn({args, stackTrace}) {
        const instance = CommandLoader.createInstance(this.nightwatchInstance, this.module, {
          stackTrace,
          args,
          commandName: this.commandName,
          isUserDefined: this.isUserDefined
        });

        if (this.module.autoInvoke) {
          this.nightwatchInstance.isES6AsyncCommand = instance.isES6AsyncCommand && this.isUserDefined;

          return instance.command(...args);
        }

        if (instance.w3c_deprecated) {
          const extraMessage = instance.deprecationNotice ? `\n  ${instance.deprecationNotice}` : '';
          // eslint-disable-next-line no-console
          console.warn(`This command has been deprecated and is removed from the W3C Webdriver standard. It is only working with legacy Selenium JSONWire protocol.${extraMessage}`);
        }

        const result = this.resolveElementSelector(args)
          .then(elementResult => {
            if (elementResult) {
              args[0] = elementResult;
            }

            this.nightwatchInstance.isES6AsyncCommand = instance.isES6AsyncCommand && this.isUserDefined;

            return instance.command(...args);
          })
          .catch(err => {
            if (instance instanceof EventEmitter) {
              if (instance.needsPromise) {
                // if the instance has `needsPromise` set to `true`, the `error` event is listened
                // on the `context` object, not on the `instance` object (in `treenode.js`).
                this.emit('error', err);
              } else {
                // for class-based commands that inherit from EventEmitter.
                // Since the `needsPromise` is set to `false` in this case, the `complete` and `error`
                // events are listened on the `instance` object.
                instance.emit('error', err);
              }

              return;
            }

            if (!['NightwatchAssertError', 'NightwatchMountError', 'TestingLibraryError'].includes(err.name)) {
              Logger.error(err);
              instance.client.reporter.registerTestError(err);
            }

            return err;
          })
          .then(result => {
            let reportErrors = instance.client.settings.report_command_errors;
            const reportNetworkErrors = instance.client.settings.report_network_errors;

            if (result && result.error && result.error.code && result.status === -1 && reportNetworkErrors) {
              // node.js errors, e.g. ECONNRESET
              reportErrors = true;
            }

            if (result && result.status === -1 && instance.reportProtocolErrors(result) && reportErrors) {
              const err = new Error(`Error while running .${this.commandName}(): ${result.error}`);

              if (result.stack) {
                err.stack = result.stack;
              }

              if (result.error instanceof Error) {
                result.error.registered = true;
              } else {
                err.registered = true;
              }

              Logger.error(err);
              instance.client.reporter.registerTestError(err);
            }

            return result;
          });

        if (instance instanceof EventEmitter) {
          return instance;
        }

        if (result instanceof Promise) {
          return result;
        }

        return result;
      };
    }

    return this;
  }

  getTargetNamespace(parent, namespacedApi) {
    let namespace;
    if (parent) {
      namespace = super.getTargetNamespace(parent);
    } else if (Array.isArray(this.namespace) && this.namespace.length > 0) {
      namespace = BaseCommandLoader.unflattenNamespace(namespacedApi || this.api, this.namespace.slice());
    }

    return namespace;
  }
}

module.exports = CommandLoader;
