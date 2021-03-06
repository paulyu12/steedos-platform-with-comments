const _ = require("underscore");

const addNotifications = function (userId, doc, members) {
    members = _.difference(members, [userId]);
    if (!members.length) {
        return;
    }
    const fromUser = Creator.getCollection("users").findOne({
        _id: userId
    }, {
        fields: {
            name: 1
        }
    });
    const notificationTitle = fromUser.name;
    let notificationDoc = {
        name: doc.name,
        body: notificationTitle,
        related_to: {
            o: "cms_posts",
            ids: [doc._id]
        },
        related_name: doc.name,
        from: userId,
        space: doc.space
    };
    Creator.addNotifications(notificationDoc, userId, members);
}

const removeNotifications = function(doc, members){
    Creator.removeNotifications(doc, members, "cms_posts");
}

const getPostMembers = function (doc, isModifierSet) {
    var members, organizations, users;
    organizations = doc.members && doc.members.organizations;
    users = doc.members && doc.members.users;
    members = [];
    if (organizations != null ? organizations.length : void 0 || users != null ? users.length : void 0) {
        if (users != null ? users.length : void 0) {
            members = users;
        }
        if (organizations != null ? organizations.length : void 0) {
            db.organizations.find({
                _id: {
                    $in: organizations
                }
            }, {
                    fields: {
                        _id: 1
                    }
                }).forEach(function (organizationItem) {
                    var organizationUsers;
                    organizationUsers = organizationItem.calculateUsers(true);
                    members = members.concat(organizationUsers);
                });
        }
    }
    return _.uniq(members);
};

module.exports = {
    listenTo: 'cms_posts',
    afterInsert: async function () {
        const doc = this.doc;
        const userId = this.userId;
        if(doc.site){
            var site = db.cms_sites.findOne({_id: doc.site}, {fields:{enable_post_permissions:1}})
            if(site && site.enable_post_permissions){
                // ??????????????????????????????????????????
                const members = getPostMembers(doc);
                if (members && members.length) {
                    addNotifications(userId, doc, members);
                }
            }
        }
    },
    afterUpdate: async function () {
        const previousDoc = this.previousDoc;
        // ??????afterUpdate?????????this.doc._id????????????this.id??????????????????????????????????????????previousDoc???????????????
        let doc = Object.assign({}, previousDoc, this.doc, {_id: this.id});
        const userId = this.userId;

        if(doc.site){
            var site = db.cms_sites.findOne({_id: doc.site}, {fields:{enable_post_permissions:1}})
            if(site && site.enable_post_permissions){
                // ??????????????????????????????????????????
                let oldMembers = getPostMembers(previousDoc);
                let newMembers = getPostMembers(doc, true);
                let addMembers = _.difference(newMembers, oldMembers);
                let subMembers = _.difference(oldMembers, newMembers);
                if (addMembers.length) {
                    addNotifications(userId, doc, addMembers);
                }
                if (subMembers.length) {
                    removeNotifications(doc, subMembers);
                }
            }
        }
    },
    afterDelete: async function () {
        // ??????afterDelete?????????this.doc????????????this.previousDoc
        const doc = this.previousDoc;
        if(doc.site){
            var site = db.cms_sites.findOne({_id: doc.site}, {fields:{enable_post_permissions:1}})
            if(site && site.enable_post_permissions){
                // ??????????????????????????????????????????
                const members = getPostMembers(doc);
                if (members && members.length) {
                    removeNotifications(doc, members);
                }
            }
        }
    }
}