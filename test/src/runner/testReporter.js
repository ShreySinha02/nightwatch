const assert = require('assert');
const path = require('path');
const mockery = require('mockery');
const rimraf = require('rimraf');

const common = require('../../common.js');
const {settings} = common;
const {runTests} = common.require('index.js');
const {mkpath} = common.require('utils');
const {readFilePromise, readDirPromise} = require('../../lib/utils.js');

const MockServer = require('../../lib/mockserver.js');
const Reporter = common.require('reporter/global-reporter.js');

describe('testReporter', function() {

  before(function(done) {
    this.server = MockServer.init();
    this.server.on('listening', () => done());
  });

  beforeEach(function(done) {
    mkpath('output', function(err) {
      if (err) {
        return done(err);
      }
      mockery.enable({useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false});
      done();
    });
  });


  afterEach(function(done) {
    mockery.deregisterAll();
    mockery.resetCache();
    mockery.disable();
    rimraf('output', done);
  });


  after(function(done) {
    this.server.close(function() {
      done();
    });
  });

  it('test with unknown reporter', function() {
    const reporter = new Reporter('unknown', {
      globals: {
        reporter(results, done) {
          done();
        }
      },
      output_folder: 'output'
    });

    return reporter.loadReporter()
      .catch(err => {
        assert.ok(err instanceof Error);
        assert.strictEqual(err.message, 'The custom reporter "unknown" cannot be resolved.');
      });
  });

  it('test with invalid reporter', function() {
    const custom_reporter = path.join(__dirname, '../../extra/reporter/notvalid.js');
    const reporter = new Reporter(custom_reporter, {
      globals: {
        reporter(results, done) {
          done();
        }
      },
      output_folder: 'output'
    });

    return reporter.loadReporter()
      .catch(err => {
        assert.strictEqual(err.message, `The custom reporter "${custom_reporter}" must have a public ".write(results, options, [callback])" method defined which should return a Promise.`);
      });
  });

  it('test with valid reporter file name', function() {

    const reporter = new Reporter(path.join(__dirname, '../../extra/reporter/custom.js'), {
      globals: {
        reporter(results, done) {
          done();
        }
      },
      output_folder: 'output'
    });

    reporter.writeReport = function (reporter, globalResults) {
      Promise.resolve();
    };

    return reporter.save().then(function(result) {
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 2);
    });
  });

  it('test with valid reporter from NPM', function() {
    mockery.registerMock('nightwatch_reporter', {
      async write(results, options) {

        return 'reporter_output';
      }
    });

    const reporter = new Reporter('nightwatch_reporter', {
      globals: {
        reporter(results, done) {
          done();
        }
      },
      output_folder: 'output',
      reporter_options: {}
    });

    return reporter.writeReportToFile().then(function(result) {
      assert.deepStrictEqual(result, ['reporter_output']);
    });
  });

  it('test run tests with multiple reporters - html + junit', async function () {
    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/simple/test/sample.js')];

    try {
      await runTests({
        source: testsPath,
        reporter: ['html', 'junit']
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function () {}
        },
        output: false
      }));

      await readFilePromise(`output${path.sep}FIREFOX_TEST_firefox__sample.xml`);
      await readDirPromise(`output${path.sep}nightwatch-html-report`);
    } catch (error) {
      possibleError = error;
    }

    assert.strictEqual(possibleError, null);
  });

  it('test run tests with default reporters', async function () {
    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/simple/test/sample.js')];

    try {
      await runTests({

        source: testsPath
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function () {}
        },
        silent: true,
        output: false
      }));

      await readFilePromise(`output${path.sep}FIREFOX_TEST_firefox__sample.xml`);
      await readFilePromise(`output${path.sep}FIREFOX_TEST_firefox__sample.json`);
      await readDirPromise(`output${path.sep}nightwatch-html-report`);
    } catch (error) {
      possibleError = error;
    }

    assert.strictEqual(possibleError, null);
  });

  it('test run tests with default reporters - open the html report', async function () {
    let htmlFile;

    mockery.registerMock('open', function(filename) {
      htmlFile = filename;

      return Promise.resolve();
    });

    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/simple/test/sample.js')];

    try {
      await runTests({
        source: testsPath,
        open: true
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function () {}
        },
        silent: true,
        output: false
      }));

      await readFilePromise(`output${path.sep}FIREFOX_TEST_firefox__sample.xml`);
      await readFilePromise(`output${path.sep}FIREFOX_TEST_firefox__sample.json`);
      await readDirPromise(`output${path.sep}nightwatch-html-report`);
    } catch (error) {
      possibleError = error;
    }

    assert.strictEqual(possibleError, null);
    assert.strictEqual(htmlFile, `output${path.sep}nightwatch-html-report${path.sep}index.html`);

  });

  it('Check reporter output for varaious properties', async function () {
    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/simple/test/sample.js')];

    try {
      await runTests({
        source: testsPath
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function (results) {
            // check for results properties
            assert.ok(Object.keys(results).includes('elapsedTime'));
            assert.ok(Object.keys(results).includes('startTimestamp'));
            assert.ok(Object.keys(results).includes('endTimestamp'));

            const module = results.modules['sample'];
            // check for module properties
            assert.ok(Object.keys(module).includes('sessionCapabilities'));
            assert.ok(Object.keys(module).includes('sessionId'));
            assert.ok(Object.keys(module).includes('projectName'));
            assert.ok(Object.keys(module).includes('buildName'));
            assert.ok(Object.keys(module).includes('startTimestamp'));
            assert.ok(Object.keys(module).includes('endTimestamp'));
            assert.ok(Object.keys(module).includes('host'));
            assert.ok(Object.keys(module).includes('name'));
            assert.ok(Object.keys(module).includes('tags'));

            // check for individual test properties
            const test = module.completed['demoTest'];
            assert.ok(Object.keys(test).includes('status'));
            assert.ok(Object.keys(test).includes('startTimestamp'));
            assert.ok(Object.keys(test).includes('endTimestamp'));
            assert.strictEqual(test.status, 'pass');
          }
        },
        silent: true,
        output: false
      }));

    } catch (error) {
      possibleError = error;
    }
    assert.strictEqual(possibleError, null);

  });

  it('Check reporter output for completedSections', async function () {
    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/sampleforreport/sample.js')];

    try {
      await runTests({
        source: testsPath
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function (results) {
            const module = results.modules['sample'];

            assert.ok(Object.keys(module).includes('completedSections'));

            const completedSections = module['completedSections'];

            // check module properties all for hooks
            const hooks = ['__after_hook', '__before_hook', '__global_afterEach_hook', '__global_beforeEach_hook', 'demoTest'];

            hooks.forEach(hook => {
              assert.ok(Object.keys(completedSections).includes(hook));

              const sectionData = completedSections[hook];
              assert.ok(Object.keys(sectionData).includes('startTimestamp'));
              assert.ok(Object.keys(sectionData).includes('endTimestamp'));
              assert.ok(Object.keys(sectionData).includes('httpOutput'));
              assert.strictEqual(sectionData['status'], 'pass');
            });
            
            assert.strictEqual(completedSections['__after_hook']['commands'].length, 1);
            assert.strictEqual(completedSections['__after_hook']['commands'][0].name, 'end');

            // check for individual test properties
            const test = completedSections['demoTest'];
            assert.ok(Object.keys(test).includes('status'));
            assert.ok(Object.keys(test).includes('commands'));

            assert.strictEqual(test.status, 'pass');
            assert.strictEqual(test.passed, 3);
            assert.strictEqual(test.failed, 0);
            assert.strictEqual(test.errors, 0);

            assert.strictEqual(test.commands.length, 4);
            assert.strictEqual(test.commands[0].name, 'assert.equal');
            assert.strictEqual(test.commands[1].name, 'url');
            assert.strictEqual(test.commands[2].name, 'assert.elementPresent');
            assert.strictEqual(test.commands[3].name, 'assert.equal');

            const command = test.commands[1];
            assert.ok(Object.keys(command).includes('startTime'));
            assert.ok(Object.keys(command).includes('endTime'));
            assert.ok(Object.keys(command).includes('elapsedTime'));
            assert.ok(Object.keys(command).includes('result'));
            assert.deepEqual(command.args, ['"http://localhost"']);
            assert.strictEqual(command.status, 'pass');

            const beforeEach = test.beforeEach;
            assert.strictEqual(beforeEach.commands.length, 0);
            assert.strictEqual(beforeEach.status, 'pass');

            const testcase = test.testcase;
            assert.strictEqual(testcase.commands.length, 3);
            assert.deepStrictEqual(testcase.commands.map(comm => comm.name), ['assert.equal', 'url', 'assert.elementPresent']);
            assert.strictEqual(testcase.status, 'pass');
            assert.strictEqual(testcase.passed, 2);
            assert.strictEqual(testcase.failed, 0);
            assert.strictEqual(testcase.errors, 0);

            const afterEach = test.afterEach;
            assert.strictEqual(afterEach.commands.length, 1);
            assert.strictEqual(afterEach.commands[0].name, 'assert.equal');
            assert.strictEqual(afterEach.status, 'pass');
            assert.strictEqual(afterEach.passed, 1);
            assert.strictEqual(afterEach.failed, 0);
            assert.strictEqual(afterEach.errors, 0);
          }
        },
        silent: true,
        output: false
      }));

    } catch (error) {
      possibleError = error;
    }
    assert.strictEqual(possibleError, null);

  });

  it('Check reporter output for completedSections with failures', async function () {
    let possibleError = null;
    const testsPath = [path.join(__dirname, '../../sampletests/sampleforreport/sampleWithFailure.js')];

    try {
      await runTests({
        source: testsPath
      },
      settings({
        output_folder: 'output',
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function (results) {
            const module = results.modules['sampleWithFailure'];

            assert.ok(Object.keys(module).includes('completedSections'));

            const completedSections = module['completedSections'];

            // check module properties all for hooks
            const hooks = ['__after_hook', '__before_hook', '__global_afterEach_hook', '__global_beforeEach_hook', 'demoTest'];

            hooks.forEach(hook => {
              assert.ok(Object.keys(completedSections).includes(hook));

              const sectionData = completedSections[hook];
              assert.ok(Object.keys(sectionData).includes('startTimestamp'));
              assert.ok(Object.keys(sectionData).includes('endTimestamp'));
              assert.ok(Object.keys(sectionData).includes('httpOutput'));
            });
            
            const afterHook = completedSections['__after_hook'];
            assert.strictEqual(afterHook['commands'].length, 2);
            assert.strictEqual(afterHook['commands'][0].name, 'assert.equal');
            assert.strictEqual(afterHook['commands'][1].name, 'end');
            assert.strictEqual(afterHook.status, 'pass');
            assert.strictEqual(afterHook.passed, 1);
            assert.strictEqual(afterHook.failed, 0);
            assert.strictEqual(afterHook.errors, 0);

            // check for individual test properties
            const test = completedSections['demoTest'];
            assert.ok(Object.keys(test).includes('status'));
            assert.ok(Object.keys(test).includes('commands'));

            assert.strictEqual(test.status, 'fail');
            assert.strictEqual(test.passed, 2);
            assert.strictEqual(test.failed, 1);
            assert.strictEqual(test.errors, 0);

            assert.strictEqual(test.commands.length, 4);
            assert.strictEqual(test.commands[0].name, 'assert.equal');
            assert.strictEqual(test.commands[1].name, 'url');
            assert.strictEqual(test.commands[2].name, 'assert.elementPresent');
            assert.strictEqual(test.commands[3].name, 'assert.equal');

            const command = test.commands[1];
            assert.ok(Object.keys(command).includes('startTime'));
            assert.ok(Object.keys(command).includes('endTime'));
            assert.ok(Object.keys(command).includes('elapsedTime'));
            assert.ok(Object.keys(command).includes('result'));
            assert.deepEqual(command.args, ['"http://localhost"']);
            assert.strictEqual(command.status, 'pass');

            const beforeEach = test.beforeEach;
            assert.strictEqual(beforeEach.commands.length, 0);
            assert.strictEqual(beforeEach.status, 'pass');

            const testcase = test.testcase;
            assert.strictEqual(testcase.commands.length, 3);
            assert.deepStrictEqual(testcase.commands.map(comm => comm.name), ['assert.equal', 'url', 'assert.elementPresent']);
            assert.strictEqual(testcase.status, 'fail');
            assert.strictEqual(testcase.passed, 1);
            assert.strictEqual(testcase.failed, 1);
            assert.strictEqual(testcase.errors, 0);

            const afterEach = test.afterEach;
            assert.strictEqual(afterEach.commands.length, 1);
            assert.strictEqual(afterEach.commands[0].name, 'assert.equal');
            assert.strictEqual(afterEach.status, 'pass');
            assert.strictEqual(afterEach.passed, 1);
            assert.strictEqual(afterEach.failed, 0);
            assert.strictEqual(afterEach.errors, 0);
          }
        },
        silent: true,
        output: false
      }));

    } catch (error) {
      possibleError = error;
    }
    assert.strictEqual(possibleError, null);

  });

  it('check reporter output with appended results', async function() {
    let possibleError = null;
    const testPath = [path.join(__dirname, '../../sampletests/appendtestresult/sampleWithAppendResults.js')];
    const customCommands = [path.join(__dirname, '../../extra/commands')];

    try {
      await runTests({
        source: testPath
      }, settings({
        custom_commands_path: customCommands,
        globals: {
          waitForConditionPollInterval: 20,
          waitForConditionTimeout: 50,
          retryAssertionTimeout: 50,
          reporter: function (results) {
            const module = results.modules['sampleWithAppendResults'];
            
            assert.ok(Object.keys(module).includes('completedSections'));
            const completedSections = module['completedSections'];
            assert.ok(Object.keys(completedSections).includes('demoTest'));

            const test = completedSections['demoTest'];
            assert.ok(Object.keys(test).includes('customReport'));
            assert.deepStrictEqual(test.customReport, {success: true});
          }
        },
        silent: true,
        output: false
      }));
    } catch (err) {
      possibleError = err;
    }
    assert.strictEqual(possibleError, null);
  });

  it('test with multiple reporters', function() {
    mockery.registerMock('nightwatch_reporter', {
      async write(_results, _options) {

        return 'nightwatch_reporter_output';
      }
    });
    mockery.registerMock('html_reporter', {
      async write(_results, _options) {

        return 'html_reporter_output';
      }
    });

    const reporter = new Reporter('nightwatch_reporter,html_reporter', {
      globals: {
        reporter(_results, done) {
          done();
        }
      },
      output_folder: 'output',
      reporter_options: {}
    });

    return reporter.writeReportToFile().then(function(result) {
      assert.deepStrictEqual(result, ['nightwatch_reporter_output', 'html_reporter_output']);
    });
  });

  it('test to check retry data logging', function() {
    this.timeout(100000);

    const testsPath = path.join(__dirname, '../../sampletests/withfailures');
    const globals = {
      calls: 0,
      reporter(results, cb) {
        assert.ok('sample' in results.modules);
        assert.ok('completedSections' in results.modules['sample']);
        assert.ok('demoTest' in results.modules['sample']['completedSections']);
        assert.ok('retryTestData' in results.modules['sample']['completedSections']['demoTest']);
        assert.ok(results.modules['sample']['completedSections']['demoTest']['retryTestData'].length <= 3);
        cb();
      },
      retryAssertionTimeout: 0
    };

    return runTests({
      retries: 3,
      _source: [testsPath]
    }, settings({
      skip_testcases_on_fail: false,
      globals
    }));
  });
});
