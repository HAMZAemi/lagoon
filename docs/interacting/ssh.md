# SSH

Lagoon allows you to connect to your running containers via SSH. The containers themselves don't actually have an SSH server installed, but instead you connect via SSH to Lagoon, which then itself creates a remote shell connection via the Kubernetes API for you.

## Ensure you are set up for SSH access

### Generating an SSH Key

It is recommended to generate a separate SSH key for each device as opposed to sharing the same key between multiple computers. Instructions for generating an SSH key on various systems can be found below:

#### OSX (Mac)

[Mac](https://www.makeuseof.com/ssh-keygen-mac){ .md-button }

#### Linux (Ubuntu)

[Linux](https://help.ubuntu.com/community/SSH/OpenSSH/Keys){ .md-button }

#### Windows

[Windows](https://docs.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement){ .md-button }

### SSH Agent

#### OSX (Mac)

OSX does not have its SSH agent configured to load configured SSH keys at startup, which can cause some headaches. You can find a handy guide to configuring this capability here: [https://www.backarapper.com/add-ssh-keys-to-ssh-agent-on-startup-in-macos/](https://www.backarapper.com/add-ssh-keys-to-ssh-agent-on-startup-in-macos/)

#### Linux

Linux distributions vary in how they use the `ssh-agent` . You can find a general guide here: [https://www.ssh.com/academy/ssh/agent](https://www.ssh.com/academy/ssh/agent)

#### Windows

SSH key support in Windows has improved markedly as of recently, and is now supported natively. A handy guide to configuring the Windows 10 SSH agent can be found here: [https://richardballard.co.uk/ssh-keys-on-windows-10/](https://richardballard.co.uk/ssh-keys-on-windows-10/)

### Uploading SSH Keys

### Via the UI

You can upload your SSH key(s) through the UI. Log in as you normally would.

In the upper right hand corner, click on Settings:

![Click "Settings" in the upper right hand corner](../images/ui-settings.png)

You will then see a page where you can upload your SSH key(s), and it will show any uploaded keys. Paste your key into the text box, give it a name, and click "Add." That's it! Add additional keys as needed.

![Paste your key into the text box.](../images/ui-ssh.png)

### Via Command Line

A general example of using the Lagoon API via GraphQL to add an SSH key to a user can be found [here](../interacting/graphql-queries.md#allowing-access-to-the-project)

## SSH into a pod

!!! Note
    The easiest way to SSH into a pod is to use the [Lagoon CLI](https://github.com/uselagoon/lagoon-cli).

    The instructions below only apply if you want to use the regular `ssh` client, or other advanced use cases.

### Connection

Connecting is straightforward and follows the following pattern:

```bash title="SSH"
ssh {% if defaults.sshport != 22 %}-p [PORT] {% endif %}[PROJECT-ENVIRONMENT-NAME]@[HOST]
```

* `HOST` - The remote shell SSH endpoint host (for example `{{ defaults.sshhostname }}`).
* `PROJECT-ENVIRONMENT-NAME` - The environment you want to connect to. This is most commonly in the pattern `PROJECTNAME-ENVIRONMENT`.

As an example:

```bash title="SSH example"
ssh {% if defaults.sshport != 22 %}-p {{ defaults.sshport }} {% endif %}drupal-example-main@{{ defaults.sshhostname }}
```

This will connect you to a `cli` pod in the environment `main` of the project `drupal-example`.

### Pod/Service, Container Definition

By default the remote shell will try to connect you to the first container in the pod of the service type `cli`.
If you would like to connect to another service you can specify it using a `service=[SERVICE-NAME]` argument to the SSH command.

!!! Note
    When you run the [`ssh` client](https://man7.org/linux/man-pages/man1/ssh.1.html) command with just a `USER@HOST` argument, it will assume that you want an interactive session and allocate a [pty](https://www.man7.org/linux/man-pages/man7/pty.7.html).
    This give you a regular shell environment where you can enter commands at a prompt, send interrupts using `^C` etc.

    However, when you provide an argument to the `ssh` client command, it assumes that you want a non-interactive session (e.g. just run a command and return) and will not allocate a pty.

    **So when providing an argument such as `service=[SERVICE-NAME]`, if you want an interactive shell session you need to tell the `ssh` client to not "auto-detect" if it needs a pty and just allocate one anyway using the `-t` flag.**

```bash title="SSH to another service example"
ssh {% if defaults.sshport != 22 %}-p [PORT] {% endif %}-t [PROJECT-ENVIRONMENT-NAME]@[HOST] service=[SERVICE-NAME]
```

If your pod/service contains multiple containers, Lagoon will connect you to the first defined container. You can also define the specific container to connect to via:

```bash title="Define container"
ssh {% if defaults.sshport != 22 %}-p [PORT] {% endif %}-t [PROJECT-ENVIRONMENT-NAME]@[HOST] service=[SERVICE-NAME] container=[CONTAINER-NAME]
```

For example, to connect to the `php` container within the `nginx` pod:

```bash title="SSH to php container"
ssh {% if defaults.sshport != 22 %}-p {{ defaults.sshport }} {% endif %}-t drupal-example-main@{{ defaults.sshhostname }} service=nginx container=php
```

## Copying files

The common case of copying a file into your `cli` pod can be achieved with the usual SSH-compatible tools.

### scp

```bash title="Copy file with scp"
scp {% if defaults.sshport != 22 %}-P {{ defaults.sshport }} {% endif %}[local_path] [project_name]-[environment_name]@{{ defaults.sshhostname }}:[remote_path]
```

### rsync

```bash title="Copy files with rsync"
rsync {% if defaults.sshport != 22 %}--rsh='ssh -p {{ defaults.sshport }}'{% else %}--rsh=ssh{% endif %} [local_path] [project_name]-[environment_name]@{{ defaults.sshhostname }}:[remote_path]
```

### tar

```bash
ssh {% if defaults.sshport != 22 %}-p {{ defaults.sshport }} {% endif %}[project_name]-[environment_name]@{{ defaults.sshhostname }} tar -zcf - [remote_path] | tar -zxf - -C /tmp/
```

### Specifying non-CLI pod/service

In the rare case that you need to specify a non-CLI service you can specify the `service=...` and/or `container=...` arguments in the copy command.

Piping `tar` through the `ssh` connection is the simplest method, and can be used to copy a file or directory using the usual `tar` flags:

```bash
ssh {% if defaults.sshport != 22 %}-p {{ defaults.sshport }} {% endif %}[project_name]-[environment_name]@{{ defaults.sshhostname }} service=solr tar -zcf - [remote_path] | tar -zxf - -C /tmp/
```

You can also use `rsync` with a wrapper script to reorder the arguments to `ssh` in the manner required by Lagoon's SSH service:

```bash
#!/usr/bin/env sh
svc=$1 user=$3 host=$4
shift 4
exec ssh {% if defaults.sshport != 22 %}-p {{ defaults.sshport }} {% endif %}-l "$user" "$host" "$svc" "$@"
```

Put that in an executable shell script `rsh.sh` and specify the `service=...` in the `rsync` command:

```bash title="rsync to non-CLI pod"
rsync --rsh="/path/to/rsh.sh service=cli" /tmp/foo [project_name]-[environment_name]@{{ defaults.sshhostname }}:/tmp/foo
```

The script could also be adjusted to also handle a `container=...` argument.