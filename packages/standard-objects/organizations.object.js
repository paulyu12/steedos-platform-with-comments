const core = require('@steedos/core');
db.organizations = core.newCollection('organizations');

if (Meteor.isClient) {
    //	db.organizations._simpleSchema.i18n("organizations")
    db.organizations._sortFunction = function (doc1, doc2) {
        var ref;
        if (doc1.sort_no === doc2.sort_no) {
            return (ref = doc1.name) != null ? ref.localeCompare(doc2.name) : void 0;
        } else if (doc1.sort_no > doc2.sort_no) {
            return -1;
        } else {
            return 1;
        }
    };
    db.organizations.getRoot = function (fields) {
        return SteedosDataManager.organizationRemote.findOne({
            parent: null
        }, {
                fields: fields
            });
    };
}

//db.organizations.attachSchema db.organizations._simpleSchema;
db.organizations.helpers({
    calculateParents: function () {
        var parentId, parentOrg, parents;
        parents = [];
        if (!this.parent) {
            return parents;
        }
        parentId = this.parent;
        while (parentId) {
            parents.push(parentId);
            parentOrg = db.organizations.findOne({
                _id: parentId
            }, {
                    parent: 1,
                    name: 1
                });
            if (parentOrg) {
                parentId = parentOrg.parent;
            } else {
                parentId = null;
            }
        }
        return parents;
    },
    calculateFullname: function () {
        var fullname, parentId, parentOrg;
        fullname = this.name;
        if (!this.parent) {
            return fullname;
        }
        parentId = this.parent;
        while (parentId) {
            parentOrg = db.organizations.findOne({
                _id: parentId
            }, {
                    parent: 1,
                    name: 1
                });
            if (parentOrg) {
                parentId = parentOrg.parent;
            } else {
                parentId = null;
            }
            if (parentId) {
                fullname = (parentOrg != null ? parentOrg.name : void 0) + "/" + fullname;
            }
        }
        return fullname;
    },
    calculateChildren: function () {
        var children, childrenObjs;
        children = [];
        childrenObjs = db.organizations.find({
            parent: this._id
        }, {
                fields: {
                    _id: 1
                }
            });
        childrenObjs.forEach(function (child) {
            return children.push(child._id);
        });
        return children;
    },
    updateUsers: function () {
        var spaceUsers, users;
        users = [];
        spaceUsers = db.space_users.find({
            organizations: this._id
        }, {
                fields: {
                    user: 1
                }
            });
        spaceUsers.forEach(function (user) {
            return users.push(user.user);
        });
        return db.organizations.direct.update({
            _id: this._id
        }, {
                $set: {
                    users: users
                }
            });
    },
    space_name: function () {
        var space;
        space = db.spaces.findOne({
            _id: this.space
        });
        return space != null ? space.name : void 0;
    },
    users_count: function () {
        if (this.users) {
            return this.users.length;
        } else {
            return 0;
        }
    },
    calculateAllChildren: function () {
        var children, childrenObjs;
        children = [];
        childrenObjs = db.organizations.find({
            parents: {
                $in: [this._id]
            }
        }, {
                fields: {
                    _id: 1
                }
            });
        childrenObjs.forEach(function (child) {
            return children.push(child._id);
        });
        return _.uniq(children);
    },
    calculateUsers: function (isIncludeParents) {
        var orgs, userOrgs, users;
        orgs = isIncludeParents ? this.calculateAllChildren() : this.calculateChildren();
        orgs.push(this._id);
        users = [];
        userOrgs = db.organizations.find({
            _id: {
                $in: orgs
            }
        }, {
                fields: {
                    users: 1
                }
            });
        userOrgs.forEach(function (org) {
            var ref;
            if (org != null ? (ref = org.users) != null ? ref.length : void 0 : void 0) {
                return users = users.concat(org.users);
            }
        });
        return _.uniq(users);
    }
});

if (Meteor.isServer) {
    const checkHasOrgAdminPermission = function (org, userId){
        let result = false;
        if(typeof org === "string"){
            org = db.organizations.findOne(org);
            if (!org) {
                throw new Meteor.Error(400, `checkHasOrgAdminPermission organizations for '${org}' is not found`);
            }
        }
        parents = org != null ? org.parents : void 0;
        if (parents) {
            parents.push(org._id);
        } else {
            parents = [org._id];
        }
        if (Creator.getCollection("company").findOne({
            organization: {
                $in: parents
            },
            admins: userId
        })) {
            result = true;
        }
        return result;
    };
    db.organizations.before.insert(function (userId, doc) {
        var broexisted, isOrgAdmin, isSpaceAdmin, nameOrg, orgexisted, parentOrg, parents, space;
        if (!userId && doc.owner) {
            userId = doc.owner;
        }
        doc.created_by = userId;
        doc.created = new Date();
        doc.modified_by = userId;
        doc.modified = new Date();
        if (!doc.space) {
            throw new Meteor.Error(400, "organizations_error_space_required");
        }
        space = db.spaces.findOne(doc.space);
        if (!space) {
            throw new Meteor.Error(400, "organizations_error_space_not_found");
        }
        isSpaceAdmin = space.admins.indexOf(userId) >= 0;
        // only space admin or org admin can insert organizations
        if (!isSpaceAdmin) {
            isOrgAdmin = false;
            if (doc.parent) {
                parentOrg = db.organizations.findOne(doc.parent);
                if (!parentOrg) {
                    throw new Meteor.Error(400, "organizations_error_parent_is_not_found");
                }
                isOrgAdmin = checkHasOrgAdminPermission(parentOrg, userId);
            } else {
                // ??????????????????????????????"before.insert"?????????userId???underfined???????????????????????????parent?????????????????????????????????????????????????????????
                isOrgAdmin = true;
            }
            if (!isOrgAdmin) {
                throw new Meteor.Error(400, "organizations_error_org_admins_only");
            }
        }
        // if doc.users
        // 	throw new Meteor.Error(400, "organizations_error_users_readonly");

        // ?????????space?????????????????????organization???parent ?????????????????? child
        if (doc.parent) {
            parentOrg = parentOrg ? parentOrg : db.organizations.findOne(doc.parent);
            if (!parentOrg) {
                throw new Meteor.Error(400, "organizations_error_parent_is_not_found");
            }
            // ?????????????????????????????????
            // if (parentOrg.children) {
            //     nameOrg = db.organizations.find({
            //         _id: {
            //             $in: parentOrg.children
            //         },
            //         name: doc.name
            //     }).count();
            //     if (nameOrg > 0) {
            //         throw new Meteor.Error(400, "organizations_error_organizations_name_exists");
            //     }
            // }
            if (!doc.company_id) {
                // ????????????????????????????????????????????? company_id
                doc.company_id = parentOrg.company_id;
            }
        } else {
            // ???????????????????????????????????????
            broexisted = db.organizations.find({
                space: doc.space
            }).count();
            if (broexisted > 0) {
                throw new Meteor.Error(400, "organizations_error_organizations_parent_required");
            }
            // ?????????????????????????????????
            // orgexisted = db.organizations.find({
            //     name: doc.name,
            //     space: doc.space,
            //     fullname: doc.name
            // }).count();
            // if (orgexisted > 0) {
            //     throw new Meteor.Error(400, "organizations_error_organizations_name_exists");
            // }
        }
        // only space admin can update organization.admins
        // ???????????????admins????????????????????????doc.admins???
        // if (!isSpaceAdmin) {
        //     if (doc.admins) {
        //         throw new Meteor.Error(400, "organizations_error_space_admins_only_for_org_admins");
        //     }
        // }
    });
    db.organizations.after.insert(function (userId, doc) {
        var insertedDoc, obj, parent, rootOrg, sUser, space_users, updateFields;
        updateFields = {};
        obj = db.organizations.findOne(doc._id);
        updateFields.parents = obj.calculateParents();
        updateFields.fullname = obj.calculateFullname();
        if (!_.isEmpty(updateFields)) {
            db.organizations.direct.update(obj._id, {
                $set: updateFields
            });
        }
        if (doc.parent) {
            parent = db.organizations.findOne(doc.parent);
            db.organizations.direct.update(parent._id, {
                $set: {
                    children: parent.calculateChildren()
                }
            });
        }
        if (!rootOrg) {
            rootOrg = db.organizations.findOne({
                space: doc.space,
                parent: null
            }, {
                    fields: {
                        _id: 1
                    }
                });
        }
        if (doc.users) {
            space_users = db.space_users.find({
                space: doc.space,
                user: {
                    $in: doc.users
                }
            }, {
                    fields: {
                        organizations: 1,
                        company_id: 1,
                        space: 1
                    }
                });
            space_users.forEach(function (su) {
                var orgs;
                orgs = su.organizations;
                orgs.push(doc._id);
                db.space_users.direct.update({
                    _id: su._id
                }, {
                        $set: {
                            organizations: orgs
                        }
                    });
                db.space_users.update_organizations_parents(su._id, orgs);
                // db.space_users.update_company_ids(su._id, su);
            });
        }
        // ??????????????????audit_logs????????????????????????
        insertedDoc = db.organizations.findOne({
            _id: doc._id
        });
        sUser = db.space_users.findOne({
            space: doc.space,
            user: userId
        }, {
                fields: {
                    name: 1
                }
            });
        if (sUser && userId) {
            return db.audit_logs.insert({
                c_name: "organizations",
                c_action: "add",
                object_id: doc._id,
                object_name: doc.name,
                value_previous: null,
                value: JSON.parse(JSON.stringify(insertedDoc)),
                created_by: userId,
                created_by_name: sUser.name,
                created: new Date()
            });
        }
    });
    db.organizations.before.update(function (userId, doc, fieldNames, modifier, options) {
        var isOrgAdmin, isParentOrgAdmin, isSpaceAdmin, nameOrg, parent, parentOrg, ref, ref1, ref2, ref3, ref4, space;
        modifier.$set = modifier.$set || {};
        space = db.spaces.findOne(doc.space);
        if (!space) {
            throw new Meteor.Error(400, "organizations_error_space_not_found");
        }
        isSpaceAdmin = space.admins.indexOf(userId) >= 0;
        /*
            ?????????????????????????????????????????????????????????
            1.????????????????????????????????????????????????????????????
            2.???????????????????????????????????????
        */
        if (!isSpaceAdmin) {
            isOrgAdmin = checkHasOrgAdminPermission(doc._id, userId);
            if (!isOrgAdmin) {
                throw new Meteor.Error(400, "organizations_error_org_admins_only");
            }
            if (((ref = modifier.$set) != null ? ref.parent : void 0) && ((ref1 = modifier.$set) != null ? ref1.parent : void 0) !== doc.parent) {
                isParentOrgAdmin = checkHasOrgAdminPermission(modifier.$set.parent, userId);
                if (!isParentOrgAdmin) {
                    throw new Meteor.Error(400, "?????????????????????????????????");
                }
            }
        }
        if (modifier.$set.space && doc.space !== modifier.$set.space) {
            throw new Meteor.Error(400, "organizations_error_space_readonly");
        }
        if (modifier.$set.parents) {
            throw new Meteor.Error(400, "organizations_error_parents_readonly");
        }
        if (modifier.$set.children) {
            throw new Meteor.Error(400, "organizations_error_children_readonly");
        }
        if (modifier.$set.fullname) {
            throw new Meteor.Error(400, "organizations_error_fullname_readonly");
        }
        // if (!isSpaceAdmin) {
        //     if (typeof doc.admins !== typeof modifier.$set.admins || ((ref2 = doc.admins) != null ? ref2.sort().join(",") : void 0) !== ((ref3 = modifier.$set.admins) != null ? ref3.sort().join(",") : void 0)) {
        //         throw new Meteor.Error(400, "organizations_error_space_admins_only_for_org_admins");
        //     }
        // }
        if (doc.parent) {
            // ????????????????????????????????????????????????????????????
            parent = modifier.$set.parent || doc.parent;
            parentOrg = db.organizations.findOne(parent);
            if (!parentOrg) {
                throw new Meteor.Error(400, "organizations_error_parent_is_not_found");
            }
        } else {
            if (modifier.$set.parent) {
                throw new Meteor.Error(400, "organizations_error_root_parent_can_not_set");
            }
        }
        modifier.$set.modified_by = userId;
        modifier.$set.modified = new Date();
        if (modifier.$set.parent) {
            // parent ???????????????????????? children
            parentOrg = parentOrg ? parentOrg : db.organizations.findOne(modifier.$set.parent);
            if (!parentOrg) {
                throw new Meteor.Error(400, "organizations_error_parent_is_not_found");
            }
            if (doc._id === parentOrg._id || (parentOrg.parents && parentOrg.parents.indexOf(doc._id) >= 0)) {
                throw new Meteor.Error(400, "organizations_error_parent_is_self");
            }
            // ?????????????????????????????????
            // // ????????? parent ?????????????????? child
            // if (parentOrg.children && modifier.$set.name) {
            //     nameOrg = db.organizations.find({
            //         _id: {
            //             $in: parentOrg.children
            //         },
            //         name: modifier.$set.name
            //     }).count();
            //     if ((nameOrg > 0) && (modifier.$set.name !== doc.name)) {
            //         throw new Meteor.Error(400, "organizations_error_organizations_name_exists");
            //     }
            // }
        }
        // ????????????doc.parent?????????????????????????????????modifier.$set.parent???????????????doc.parent?????????????????????????????????????????????
        if (doc.parent && _.has(modifier.$set, 'parent') && !modifier.$set.parent){
            // ?????????parent, ??????$set ??????parent??????????????????
            throw new Meteor.Error(400, "organizations_error_organizations_parent_required");
        }
        // else if (modifier.$set.name != doc.name)
        // 	existed = db.organizations.find({name: modifier.$set.name, space: doc.space,fullname:modifier.$set.name}).count()
        // 	if existed > 0
        // 		throw new Meteor.Error(400, "organizations_error.organizations_name_exists"))
        if ((ref4 = modifier.$unset) != null ? ref4.name : void 0) {
            throw new Meteor.Error(400, "organizations_error_organization_name_required");
        }
    });
    db.organizations.after.update(function (userId, doc, fieldNames, modifier, options) {
        var added_space_users, added_users, children, newParent, new_users, obj, oldParent, old_users, removed_space_users, removed_users, rootOrg, sUser, updateFields, updatedDoc;
        modifier.$set = modifier.$set || {};
        modifier.$unset = modifier.$unset || {};
        updateFields = {};
        obj = db.organizations.findOne(doc._id);
        if (obj.parent) {
            updateFields.parents = obj.calculateParents();
        }
        if (modifier.$set.parent) {
            newParent = db.organizations.findOne(doc.parent);
            db.organizations.direct.update(newParent._id, {
                $set: {
                    children: newParent.calculateChildren()
                }
            });
            oldParent = db.organizations.find({
                children: doc._id
            });
            oldParent.forEach(function (organization) {
                var existed;
                existed = db.organizations.find({
                    _id: doc._id,
                    parent: organization._id
                }).count();
                if (existed === 0) {
                    return db.organizations.direct.update({
                        _id: organization._id
                    }, {
                            $pull: {
                                children: doc._id
                            }
                        });
                }
            });
        }
        // ???????????? parent ??? name, ???????????? ????????????????????? fullname
        if (modifier.$set.parent || modifier.$set.name) {
            updateFields.fullname = obj.calculateFullname();
            children = db.organizations.find({
                parents: doc._id
            });
            children.forEach(function (child) {
                var childSet;
                childSet = {
                    fullname: child.calculateFullname()
                };
                if (modifier.$set.parent) {
                    childSet.parents = child.calculateParents();
                }
                return db.organizations.direct.update(child._id, {
                    $set: childSet
                });
            });
        }
        if (!_.isEmpty(updateFields)) {
            db.organizations.direct.update(obj._id, {
                $set: updateFields
            });
        }
        old_users = this.previous.users || [];
        new_users = modifier.$set.users || [];
        // ???????????????????????????modifier.$set.users?????????undefined
        if (!rootOrg) {
            rootOrg = db.organizations.findOne({
                space: doc.space,
                parent: null
            }, {
                    fields: {
                        _id: 1
                    }
                });
        }
        if (modifier.$set.users || modifier.$unset.users !== void 0) {
            added_users = _.difference(new_users, old_users);
            removed_users = _.difference(old_users, new_users);
            if (added_users.length > 0) {
                added_space_users = db.space_users.find({
                    space: doc.space,
                    user: {
                        $in: added_users
                    }
                }, {
                        fields: {
                            organizations: 1,
                            company_id: 1,
                            space: 1
                        }
                    });
                added_space_users.forEach(function (su) {
                    var orgs;
                    orgs = su.organizations;
                    orgs.push(doc._id);
                    db.space_users.direct.update({
                        _id: su._id
                    }, {
                            $set: {
                                organizations: orgs
                            }
                        });
                    db.space_users.update_organizations_parents(su._id, orgs);
                    // return db.space_users.update_company_ids(su._id, su);
                });
            }
            if (removed_users.length > 0) {
                removed_space_users = db.space_users.find({
                    space: doc.space,
                    user: {
                        $in: removed_users
                    }
                }, {
                        fields: {
                            organization: 1,
                            organizations: 1,
                            company_id: 1,
                            space: 1
                        }
                    });
                removed_space_users.forEach(function (su) {
                    var new_orgs, orgs, top_organization;
                    // ??????????????????????????????????????????organization?????????company_id?????????????????????????????????organization.company_id???
                    orgs = su.organizations;
                    if (orgs.length === 1) {
                        db.space_users.direct.update({
                            _id: su._id
                        }, {
                                $set: {
                                    organizations: [rootOrg._id],
                                    organization: rootOrg._id,
                                    company_id: rootOrg._id
                                }
                            });
                        db.space_users.update_organizations_parents(su._id, [rootOrg._id]);
                        // db.space_users.update_company_ids(su._id, su);
                        return db.space_users.update_company(su._id, rootOrg._id);
                    } else if (orgs.length > 1) {
                        new_orgs = _.filter(orgs, function (org_id) {
                            return org_id !== doc._id;
                        });
                        if (su.organization === doc._id) {
                            top_organization = db.organizations.findOne(new_orgs[0], {
                                fields: {
                                    company_id: 1
                                }
                            });
                            db.space_users.direct.update({
                                _id: su._id
                            }, {
                                    $set: {
                                        organizations: new_orgs,
                                        organization: new_orgs[0],
                                        company_id: top_organization.company_id
                                    }
                                });
                            // db.space_users.update_company(su._id, top_organization.company_id);
                        } else {
                            db.space_users.direct.update({
                                _id: su._id
                            }, {
                                    $set: {
                                        organizations: new_orgs
                                    }
                                });
                        }
                        db.space_users.update_organizations_parents(su._id, new_orgs);
                        // return db.space_users.update_company_ids(su._id, su);
                    }
                });
            }
        }
        //???????????????parent???, ?????????space_user???organizations_parents
        if (modifier.$set.parent) {
            children = db.organizations.find({
                parents: doc._id
            }, {
                    fields: {
                        _id: 1
                    }
                });
            children.forEach(function (child) {
                var childUsers;
                childUsers = db.space_users.find({
                    organizations: child._id
                }, {
                        fields: {
                            _id: 1,
                            organizations: 1
                        }
                    });
                return childUsers.forEach(function (su) {
                    return db.space_users.update_organizations_parents(su._id, su.organizations);
                });
            });
        }
        if (modifier.$set.name && modifier.$set.name !== this.previous.name && !doc.parent) {
            // ???????????????????????????????????????????????????
            db.spaces.direct.update({
                _id: doc.space
            }, {
                    $set: {
                        name: modifier.$set.name
                    }
                });
        }
        // ??????????????????audit_logs????????????????????????
        updatedDoc = db.organizations.findOne({
            _id: doc._id
        });
        sUser = db.space_users.findOne({
            space: doc.space,
            user: userId
        }, {
                fields: {
                    name: 1
                }
            });
        if (sUser && userId) {
            return db.audit_logs.insert({
                c_name: "organizations",
                c_action: "edit",
                object_id: doc._id,
                object_name: doc.name,
                value_previous: this.previous,
                value: JSON.parse(JSON.stringify(updatedDoc)),
                created_by: userId,
                created_by_name: sUser.name,
                created: new Date()
            });
        }
    });
    db.organizations.before.remove(function (userId, doc) {
        var isOrgAdmin, isSpaceAdmin, parents, ref, space;
        // check space exists
        space = db.spaces.findOne(doc.space);
        if (!space) {
            throw new Meteor.Error(400, "organizations_error_space_not_found");
        }
        isSpaceAdmin = space.admins.indexOf(userId) >= 0;
        // only space admin or org admin can remove organizations
        if (!isSpaceAdmin) {
            isOrgAdmin = checkHasOrgAdminPermission(doc, userId);
            if (!isOrgAdmin) {
                throw new Meteor.Error(400, "organizations_error_org_admins_only");
            }
        }
        // can not delete organization with children
        if (doc.children && doc.children.length > 0) {
            throw new Meteor.Error(400, "organizations_error_organization_has_children");
        }
        if (doc.users && doc.users.length > 0) {
            throw new Meteor.Error(400, "organizations_error_organization_has_users");
        }
        if (!doc.parent) {
            throw new Meteor.Error(400, "organizations_error_can_not_remove_root_organization");
        }
    });
    db.organizations.after.remove(function (userId, doc) {
        var parent, sUser;
        if (doc.parent) {
            parent = db.organizations.findOne(doc.parent);
            db.organizations.direct.update(parent._id, {
                $set: {
                    children: parent.calculateChildren()
                }
            });
        }
        sUser = db.space_users.findOne({
            space: doc.space,
            user: userId
        }, {
                fields: {
                    name: 1
                }
            });
        if (sUser) {
            return db.audit_logs.insert({
                c_name: "organizations",
                c_action: "delete",
                object_id: doc._id,
                object_name: doc.name,
                value_previous: doc,
                value: null,
                created_by: userId,
                created_by_name: sUser.name,
                created: new Date()
            });
        }
    });
    Meteor.publish('organizations', function (spaceId) {
        var selector;
        if (!this.userId) {
            return this.ready();
        }
        if (!spaceId) {
            return this.ready();
        }
        selector = {
            space: spaceId
        };
        return db.organizations.find(selector);
    });
    Meteor.publish('organization', function (orgId) {
        var selector;
        if (!this.userId) {
            return this.ready();
        }
        if (!orgId) {
            return this.ready();
        }
        selector = {
            _id: orgId
        };
        return db.organizations.find(selector);
    });
    Meteor.publish('root_organization', function (spaceId) {
        var selector;
        if (!this.userId) {
            return this.ready();
        }
        if (!spaceId) {
            return this.ready();
        }
        selector = {
            space: spaceId,
            parent: null
        };
        return db.organizations.find(selector);
    });
    Meteor.publish('my_organizations', function (spaceId) {
        if (!this.userId) {
            return this.ready();
        }
        if (!spaceId) {
            return this.ready();
        }
        return db.organizations.find({
            space: spaceId,
            users: this.userId
        });
    });
}