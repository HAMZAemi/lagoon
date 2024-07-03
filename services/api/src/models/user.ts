import * as R from 'ramda';
import pickNonNil from '../util/pickNonNil';
import { logger } from '../loggers/logger';
import UserRepresentation from 'keycloak-admin/lib/defs/userRepresentation';
import { Group } from './group';
import { sqlClientPool } from '../clients/sqlClient';
import { query } from '../util/db';
import { Sql } from '../resources/user/sql';
import { getConfigFromEnv } from '../util/config';
import { Helpers as groupHelpers } from '../resources/group/helpers';
import { getRedisKeycloakCache } from '../clients/redisClient';

interface IUserAttributes {
  comment?: [string];
  [propName: string]: any;
}
export interface User {
  email: string;
  username: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  comment?: string;
  lastAccessed?: string;
  gitlabId?: string;
  attributes?: IUserAttributes;
  owner?: boolean;
  admin?: boolean;
}

interface UserEdit {
  id: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  comment?: string;
  gitlabId?: string;
}

interface UserModel {
  loadAllUsers: () => Promise<User[]>;
  loadUserById: (id: string) => Promise<User>;
  loadUserByUsername: (email: string) => Promise<User>;
  loadUserByIdOrUsername: (userInput: UserEdit) => Promise<User>;
  loadUsersByOrganizationId: (organizationId: number) => Promise<User[]>;
  getAllOrganizationIdsForUser: (userInput: User) => Promise<number[]>;
  getAllGroupsForUser: (userId: string) => Promise<Group[]>;
  getAllProjectsIdsForUser: (userId: string, groups?: Group[]) => Promise<{}>;
  getUserRolesForProject: (
    userInput: User,
    projectId: number,
    userGroups: Group[]
  ) => Promise<string[]>;
  addUser: (userInput: User, resetPassword?: Boolean) => Promise<User>;
  updateUser: (userInput: UserEdit) => Promise<User>;
  deleteUser: (id: string) => Promise<void>;
  resetUserPassword: (id: string) => Promise<void>;
  userLastAccessed: (userInput: User) => Promise<Boolean>;
  transformKeycloakUsers: (keycloakUsers: UserRepresentation[]) => Promise<User[]>;
}

interface AttributeFilterFn {
  (attribute: { name: string; value: string[] }): boolean;
}

export class UsernameExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsernameExistsError';
  }
}

export class UserNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

const attrLens = R.lensPath(['attributes']);
const commentLens = R.lensPath(['comment']);

const lagoonOrganizationsLens = R.lensPath(['lagoon-organizations']);
const lagoonOrganizationsAdminLens = R.lensPath(['lagoon-organizations-admin']);
const lagoonOrganizationsViewerLens = R.lensPath(['lagoon-organizations-viewer']);

const attrLagoonProjectsLens = R.compose(
  // @ts-ignore
  attrLens,
  lagoonOrganizationsLens,
  lagoonOrganizationsAdminLens,
  lagoonOrganizationsViewerLens,
  R.lensPath([0])
);

const attrLagoonOrgOwnerLens = R.compose(
  // @ts-ignore
  attrLens,
  lagoonOrganizationsLens,
  R.lensPath([0])
);

const attrLagoonOrgAdminLens = R.compose(
  // @ts-ignore
  attrLens,
  lagoonOrganizationsAdminLens,
  R.lensPath([0])
);

const attrLagoonOrgViewerLens = R.compose(
  // @ts-ignore
  attrLens,
  lagoonOrganizationsViewerLens,
  R.lensPath([0])
);

const attrCommentLens = R.compose(
  // @ts-ignore
  attrLens,
  commentLens,
  R.lensPath([0])
);

export const User = (clients: {
  keycloakAdminClient: any;
  redisClient: any;
  sqlClientPool: any;
  esClient: any;
}): UserModel => {
  const { keycloakAdminClient } = clients;

  // filter for user attributes like `lagoon-organizations`
  const filterUsersByAttribute = (
    users: User[],
    filterFn: AttributeFilterFn
  ): User[] =>
    R.filter((user: User) =>
      R.pipe(
        R.toPairs,
        R.reduce((isMatch: boolean, attribute: [string, string[]]): boolean => {
          if (!isMatch) {
            return filterFn({
              name: attribute[0],
              value: attribute[1]
            });
          }

          return isMatch;
        }, false)
      )(user.attributes)
    )(users);

  const fetchGitlabId = async (user: User): Promise<string> => {
    const identities = await keycloakAdminClient.users.listFederatedIdentities({
      id: user.id
    });

    const gitlabIdentity = R.find(
      R.propEq('identityProvider', 'gitlab'),
      identities
    );

    // @ts-ignore
    return R.defaultTo(undefined, R.prop('userId', gitlabIdentity));
  };

  const transformKeycloakUsers = async (
    keycloakUsers: UserRepresentation[]
  ): Promise<User[]> => {
    // Map from keycloak object to user object
    const users = keycloakUsers.map(
      (keycloakUser: UserRepresentation): User =>
        // @ts-ignore
        R.pipe(
          R.pick(['id', 'email', 'username', 'firstName', 'lastName', 'attributes', 'admin', 'owner']),
          // @ts-ignore
          R.set(commentLens, R.view(attrCommentLens, keycloakUser))
        )(keycloakUser)
    );

    let usersWithGitlabIdFetch = [];

    for (const user of users) {
      const userdate = await query(
        sqlClientPool,
        Sql.selectLastAccessed(user.id)
      );
      if (userdate.length) {
        user.lastAccessed = userdate[0].lastAccessed
      }
      usersWithGitlabIdFetch.push({
        ...user,
        gitlabId: await fetchGitlabId(user)
      });
    }

    return usersWithGitlabIdFetch;
  };

  const linkUserToGitlab = async (
    user: User,
    gitlabUserId: string
  ): Promise<void> => {
    try {
      // Add Gitlab Federated Identity to User
      await keycloakAdminClient.users.addToFederatedIdentity({
        id: user.id,
        federatedIdentityId: 'gitlab',
        federatedIdentity: {
          identityProvider: 'gitlab',
          userId: gitlabUserId,
          userName: gitlabUserId // we don't map the username, instead just use the UID again
        }
      });
    } catch (err) {
      throw new Error(
        `Error linking user "${user.email}" to Gitlab Federated Identity: ${err}`
      );
    }
  };

  const unlinkUserFromGitlab = async (user: User): Promise<void> => {
    try {
      // Remove Gitlab Federated Identity from User
      await keycloakAdminClient.users.delFromFederatedIdentity({
        id: user.id,
        federatedIdentityId: 'gitlab'
      });
    } catch (err) {
      if (err.response.status && err.response.status === 404) {
        // No-op
      } else {
        throw new Error(
          `Error unlinking user "${user.email}" from Gitlab Federated Identity: ${err}`
        );
      }
    }
  };

  const loadUserById = async (id: string): Promise<User> => {
    let keycloakUser: User
    keycloakUser = await keycloakAdminClient.users.findOne({
      id
    });
    const users = await transformKeycloakUsers([keycloakUser]);
    keycloakUser = users[0]

    if (R.isNil(keycloakUser)) {
      throw new UserNotFoundError(`User not found a: ${id}`);
    }
    return keycloakUser;
  };

  // used by project resolver only, so leave this one out of redis for now
  const loadUserByUsername = async (email: string): Promise<User> => {
    const keycloakUsers = await keycloakAdminClient.users.find({
      email
    });

    if (R.isEmpty(keycloakUsers)) {
      throw new UserNotFoundError(`User not found: ${email}`);
    }

    const userId = R.pipe(
      R.filter(R.propEq('email', email)),
      R.path(['0', 'id'])
    )(keycloakUsers);

    if (R.isNil(userId)) {
      throw new UserNotFoundError(`User not found: ${email}`);
    }

    // @ts-ignore
    return await loadUserById(userId);
  };

  const loadUserByIdOrUsername = async (userInput: UserEdit): Promise<User> => {
    if (R.prop('id', userInput)) {
      return loadUserById(R.prop('id', userInput));
    }

    if (R.prop('email', userInput)) {
      return loadUserByUsername(R.prop('email', userInput));
    }

    throw new Error('You must provide a user id or email');
  };

  // used to list onwers of organizations
  const loadUsersByOrganizationId = async (organizationId: number): Promise<User[]> => {
    const ownerFilter = attribute => {
      if (attribute.name === 'lagoon-organizations') {
        const value = R.is(Array, attribute.value)
          ? R.path(['value', 0], attribute)
          : attribute.value;
        return R.test(new RegExp(`\\b${organizationId}\\b`), value);
      }

      return false;
    };
    const adminFilter = attribute => {
      if (attribute.name === 'lagoon-organizations-admin') {
        const value = R.is(Array, attribute.value)
          ? R.path(['value', 0], attribute)
          : attribute.value;
        return R.test(new RegExp(`\\b${organizationId}\\b`), value);
      }

      return false;
    };
    const viewerFilter = attribute => {
      if (attribute.name === 'lagoon-organizations-viewer') {
        const value = R.is(Array, attribute.value)
          ? R.path(['value', 0], attribute)
          : attribute.value;
        return R.test(new RegExp(`\\b${organizationId}\\b`), value);
      }

      return false;
    };

    const keycloakUsers = await keycloakAdminClient.users.find({briefRepresentation: false, max: -1});

    let filteredOwners = filterUsersByAttribute(keycloakUsers, ownerFilter);
    let filteredAdmins = filterUsersByAttribute(keycloakUsers, adminFilter);
    let filteredViewers = filterUsersByAttribute(keycloakUsers, viewerFilter);
    for (const f1 in filteredOwners) {
      filteredOwners[f1].owner = true
    }
    for (const f1 in filteredAdmins) {
      filteredAdmins[f1].admin = true
    }
    const orgUsers = [...filteredOwners, ...filteredAdmins, ...filteredViewers]

    const users = await transformKeycloakUsers(orgUsers);

    return users;
  };

  const loadAllUsers = async (): Promise<User[]> => {
    const keycloakUsers = await keycloakAdminClient.users.find({
      max: -1
    });

    const users = await transformKeycloakUsers(keycloakUsers);

    return users;
  };

  const getAllGroupsForUser = async (userId: string, organization?: number): Promise<Group[]> => {
    const GroupModel = Group(clients);
    const roleSubgroups = await keycloakAdminClient.users.listGroups({
      id: userId,
      briefRepresentation: false
    });

    const regexp = /-(owner|maintainer|developer|reporter|guest)$/g;
    let userGroups = [];
    for (const ug of roleSubgroups) {
      // push the group ids into an array of group ids only for sql lookups
      let index = userGroups.findIndex((item) => item.name === ug.name.replace(regexp, ""));
      if (index === -1) {
        const parentGroup = await GroupModel.loadGroupByName(ug.name.replace(regexp, ""))
        if (organization) {
          const parentOrg = R.defaultTo('', R.prop('lagoon-organization',  parentGroup.attributes)).toString()
          const orgid = parentOrg.split(',')[0]
          if (parseInt(orgid, 10) != organization) {
            continue
          }
        }
        // only set the users role-group as the subgroup, this is because `loadGroupByName` retrieves all the subgroups not just the one the user is in
        parentGroup.subGroups = [ug]
        userGroups.push(parentGroup);
      }
    }

    const retGroups = await GroupModel.transformKeycloakGroups(userGroups);
    return retGroups;
  };

  const getAllProjectsIdsForUser = async (
    userId: string,
    groups?: Group[]
    ): Promise<{}> => {
    const GroupModel = Group(clients);
    let userGroups = [];
    if (!groups) {
      groups = await keycloakAdminClient.users.listGroups({
        id: userId,
        briefRepresentation: false
      });
    }

    const regexp = /-(owner|maintainer|developer|reporter|guest)$/g;
    for (const ug of groups) {
      // push the group ids into an array of group ids only for sql lookups
      let index = userGroups.findIndex((item) => item.name === ug.name.replace(regexp, ""));
      if (index === -1) {
        const parentGroup = await GroupModel.loadGroupByName(ug.name.replace(regexp, ""))
        userGroups.push(parentGroup);
      }
    }
    let roleProjectIds = {};
    for (const roleSubgroup of userGroups) {
      for (const fullSubgroup of groups) {
        for (const group of fullSubgroup.subGroups) {
          // filter out the users roles subgroup from the main group so the correct roles are attached to the project ids
          if (roleSubgroup.name.replace(regexp, "") == fullSubgroup.name) {
            // https://github.com/uselagoon/lagoon/pull/3358 references potential issue with the lagoon-projects attribute where there could be empty values
            // getProjectsFromGroupAndSubgroups already covers this fix
            const projectIds = await GroupModel.getProjectsFromGroupAndSubgroups(
              roleSubgroup
            );
            if (!roleProjectIds[group.realmRoles[0]]) {
              roleProjectIds[group.realmRoles[0]] = []
            }
            projectIds.forEach(pid => {
              roleProjectIds[group.realmRoles[0]].indexOf(pid) === -1 ? roleProjectIds[group.realmRoles[0]].push(pid) : ""
            })
          }
        }
      }
    }
    return roleProjectIds;
  };

  const getUserRolesForProject = async (
    userInput: User,
    projectId: number,
    userGroups: Group[]
  ): Promise<string[]> => {
    const GroupModel = Group(clients);

    let roles = [];
    for (const group of userGroups) {
      const projectIds = await GroupModel.getProjectsFromGroupAndSubgroups(
        group
      );

      if (projectIds.includes(projectId)) {
        const groupRoles = R.pipe(
          R.filter(membership =>
            R.pathEq(['user', 'id'], userInput.id, membership)
          ),
          R.pluck('role')
        )(group.members);

        roles = [...roles, ...groupRoles];
      }
    }

    return R.uniq(roles);
  };

  const addUser = async (userInput: User, resetPassword?: Boolean): Promise<User> => {
    let response: { id: string };
    try {
      response = await keycloakAdminClient.users.create({
        ...pickNonNil(
          ['email', 'username', 'firstName', 'lastName'],
          userInput
        ),
        enabled: true,
        attributes: {
          comment: [R.defaultTo('', R.prop('comment', userInput))]
        }
      });
    } catch (err) {
      if (err.response.status && err.response.status === 409) {
        throw new UsernameExistsError(
          `Username ${R.prop('username', userInput)} exists`
        );
      } else {
        throw new Error(`Error creating Keycloak user: ${err.message}`);
      }
    }

    const user = await loadUserById(response.id);

    // If user has been created with a gitlabid, we map that ID to the user in Keycloak
    if (R.prop('gitlabId', userInput)) {
      await linkUserToGitlab(user, R.prop('gitlabId', userInput));
    }

    if (resetPassword) {
      await keycloakAdminClient.users.executeActionsEmail({
        id: user.id,
        lifespan: 43200,
        actions: ["UPDATE_PASSWORD"],
        clientId: "lagoon-ui",
        redirectUri: getConfigFromEnv('UI_URL', "http://localhost:8888")
      });
    }

    return {
      ...user,
      gitlabId: R.prop('gitlabId', userInput)
    };
  };

  const removeOrgFromAttr = (attr, organization, user) => {
    return R.pipe(
      // @ts-ignore
      R.view(attr),
      R.defaultTo(`${organization}`),
      R.split(','),
      R.without(`${organization}`),
      R.uniq,
      R.join(',')
      // @ts-ignore
    )(user);
  }

  const addOrgToAttr = (attr, organization, user) => {
    return R.pipe(
      // @ts-ignore
      R.view(attr),
      R.defaultTo(`${organization}`),
      R.split(','),
      R.append(`${organization}`),
      R.uniq,
      R.join(',')
      // @ts-ignore
    )(user);
  }

  const resetUserPassword = async (id: string): Promise<void> => {
    try {
      await keycloakAdminClient.users.executeActionsEmail({
        id: id,
        lifespan: 43200,
        actions: ["UPDATE_PASSWORD"],
        clientId: "lagoon-ui",
        redirectUri: getConfigFromEnv('UI_URL', "http://localhost:8888")
      });
    } catch (err) {
      if (err.response.status && err.response.status === 404) {
        throw new UserNotFoundError(`User not found: ${id}`);
      } else {
        throw new Error(`Error updating Keycloak user: ${err.message}`);
      }
    }
  };

  const userLastAccessed = async (userInput: User): Promise<Boolean> => {
    // set the last accessed as a unix timestamp on the user attributes
    try {
      await query(
        sqlClientPool,
        Sql.updateLastAccessed(userInput.id)
      );
    } catch (err) {
      logger.warn(`Error updating user: ${err.message}`);
    }
    return true
  };

  const updateUser = async (userInput: UserEdit): Promise<User> => {
    // comments used to be removed when updating a user, now they aren't
    let organizations = null;
    let organizationsAdmin = null;
    let organizationsView = null;
    let comment = null;
    // update a users organization if required, hooks into the existing update user function, but is used by the addusertoorganization resolver
    try {
      // collect users existing attributes
      const user = await loadUserById(userInput.id);
      // set the comment if provided
      if (R.prop('comment', userInput)) {
        comment = {comment: R.prop('comment', userInput)}
      }
      // set the organization if provided
      if (R.prop('organization', userInput)) {
        // owner is an option, default is view
        if (R.prop('remove', userInput)) {
          organizations = {'lagoon-organizations': [removeOrgFromAttr(attrLagoonOrgOwnerLens, R.prop('organization', userInput), user)]}
          organizationsAdmin = {'lagoon-organizations-admin': [removeOrgFromAttr(attrLagoonOrgAdminLens, R.prop('organization', userInput), user)]}
          organizationsView = {'lagoon-organizations-viewer': [removeOrgFromAttr(attrLagoonOrgViewerLens, R.prop('organization', userInput), user)]}
        } else {
          if (R.prop('owner', userInput)) {
            organizations = {'lagoon-organizations': [addOrgToAttr(attrLagoonOrgOwnerLens, R.prop('organization', userInput), user)]}
            organizationsAdmin = {'lagoon-organizations-admin': [removeOrgFromAttr(attrLagoonOrgAdminLens, R.prop('organization', userInput), user)]}
            organizationsView = {'lagoon-organizations-viewer': [removeOrgFromAttr(attrLagoonOrgViewerLens, R.prop('organization', userInput), user)]}
          } else {
            if (R.prop('admin', userInput)) {
              organizations = {'lagoon-organizations': [removeOrgFromAttr(attrLagoonOrgOwnerLens, R.prop('organization', userInput), user)]}
              organizationsAdmin = {'lagoon-organizations-admin': [addOrgToAttr(attrLagoonOrgAdminLens, R.prop('organization', userInput), user)]}
              organizationsView = {'lagoon-organizations-viewer': [removeOrgFromAttr(attrLagoonOrgViewerLens, R.prop('organization', userInput), user)]}
            } else {
              organizations = {'lagoon-organizations': [removeOrgFromAttr(attrLagoonOrgOwnerLens, R.prop('organization', userInput), user)]}
              organizationsAdmin = {'lagoon-organizations-admin': [removeOrgFromAttr(attrLagoonOrgAdminLens, R.prop('organization', userInput), user)]}
              organizationsView = {'lagoon-organizations-viewer': [addOrgToAttr(attrLagoonOrgViewerLens, R.prop('organization', userInput), user)]}
            }
          }
        }
      }

      await keycloakAdminClient.users.update(
        {
          id: userInput.id
        },
        {
          ...pickNonNil(
            ['email', 'username', 'firstName', 'lastName'],
            userInput
          ),
          attributes: {
            ...user.attributes,
            ...organizations,
            ...organizationsAdmin,
            ...organizationsView,
            ...comment
          }
        }
      );
    } catch (err) {
      if (err.response.status && err.response.status === 404) {
        throw new UserNotFoundError(`User not found: ${userInput.id}`);
      } else {
        throw new Error(`Error updating Keycloak user: ${err.message}`);
      }
    }

    const user = await loadUserById(userInput.id);

    // If gitlabId was passed, assume it's changed
    if (R.prop('gitlabId', userInput)) {
      await unlinkUserFromGitlab(user);
      await linkUserToGitlab(user, R.prop('gitlabId', userInput));
    }

    return {
      ...user,
      gitlabId: R.prop('gitlabId', userInput)
    };
  };

  const deleteUser = async (id: string): Promise<void> => {
    try {
      // delete the ssh keys of the user
      await query(
        sqlClientPool,
        Sql.deleteFromSshKeys(id)
      );
      // delete from the reference table
      await query(
        sqlClientPool,
        Sql.deleteFromUserSshKeys(id)
      );
      // delete from the user table
      await query(
        sqlClientPool,
        Sql.deleteFromUser(id)
      );

      await keycloakAdminClient.users.del({ id });
    } catch (err) {
      if (err.response.status && err.response.status === 404) {
        throw new UserNotFoundError(`User not found: ${id}`);
      } else {
        throw new Error(`Error deleting user ${id}: ${err}`);
      }
    }
  };

  const getAllOrganizationIdsForUser = async (
    userInput: User
  ): Promise<number[]> => {
    let organizations = [];

    const user = await loadUserById(userInput.id);
    const usersOrgs = R.defaultTo('', R.prop('lagoon-organizations',  user.attributes)).toString()
    const usersOrgsAdmin = R.defaultTo('', R.prop('lagoon-organizations-admin',  user.attributes)).toString()
    const usersOrgsViewer = R.defaultTo('', R.prop('lagoon-organizations-viewer',  user.attributes)).toString()

    if (usersOrgs != "" ) {
      const usersOrgsArr = usersOrgs.split(',');
      for (const userOrg of usersOrgsArr) {
        organizations = [...organizations, userOrg]
      }
    }
    if (usersOrgsAdmin != "" ) {
      const usersOrgsArr = usersOrgsAdmin.split(',');
      for (const userOrg of usersOrgsArr) {
        organizations = [...organizations, userOrg]
      }
    }
    if (usersOrgsViewer != "" ) {
      const usersOrgsArr = usersOrgsViewer.split(',');
      for (const userOrg of usersOrgsArr) {
        organizations = [...organizations, userOrg]
      }
    }
    return R.uniq(organizations);
  };

  return {
    loadAllUsers,
    loadUserById,
    loadUserByUsername,
    loadUserByIdOrUsername,
    loadUsersByOrganizationId,
    getAllOrganizationIdsForUser,
    getAllGroupsForUser,
    getAllProjectsIdsForUser,
    getUserRolesForProject,
    addUser,
    updateUser,
    userLastAccessed,
    deleteUser,
    resetUserPassword,
    transformKeycloakUsers
  };
};
