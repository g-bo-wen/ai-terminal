import { CommandTagParserService } from './command-tag-parser.service';

describe('CommandTagParserService', () => {
  let service: CommandTagParserService;

  beforeEach(() => {
    service = new CommandTagParserService();
  });

  it('keeps ordinary advice without commands', () => {
    const result = service.formatContentWithCommandTags('先确认当前目录，再决定下一步。');

    expect(result.formattedText).toBe('先确认当前目录，再决定下一步。');
    expect(result.commands).toEqual([]);
  });

  it('parses one CMD command', () => {
    const result = service.formatContentWithCommandTags('<CMD title="查看目录" risk="safe">pwd</CMD>');

    expect(result.commands).toEqual([
      {
        title: '查看目录',
        command: 'pwd',
        risk: 'safe',
        raw: '<CMD title="查看目录" risk="safe">pwd</CMD>'
      }
    ]);
    expect(result.formattedText).toContain('<code-block-0></code-block-0>');
  });

  it('parses multiple CMD commands', () => {
    const result = service.parseCommandTags([
      '<CMD title="系统版本" risk="safe">cat /etc/os-release</CMD>',
      '<CMD title="磁盘" risk="safe">df -h</CMD>'
    ].join('\n'));

    expect(result.map(command => command.command)).toEqual(['cat /etc/os-release', 'df -h']);
  });

  it('preserves normal text around CMD commands', () => {
    const result = service.formatContentWithCommandTags(
      '可以先看目录。\n<CMD title="查看目录" risk="safe">ls -la</CMD>\n这是只读命令。'
    );

    expect(result.formattedText).toContain('可以先看目录。');
    expect(result.formattedText).toContain('<code-block-0></code-block-0>');
    expect(result.formattedText).toContain('这是只读命令。');
  });

  it('parses danger risk for confirmation by the UI', () => {
    const [command] = service.parseCommandTags('<CMD title="删除缓存" risk="danger">rm -rf cache</CMD>');

    expect(command.risk).toBe('danger');
  });

  it('does not crash or create executable commands for invalid multiline CMD tags', () => {
    const result = service.formatContentWithCommandTags('<CMD title="坏命令" risk="safe">echo one\necho two</CMD>');

    expect(result.commands).toEqual([]);
    expect(result.formattedText).toContain('&lt;CMD');
  });
});
