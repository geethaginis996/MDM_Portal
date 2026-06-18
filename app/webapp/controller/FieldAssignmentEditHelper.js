sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Fragment, JSONModel, MessageToast, MessageBox) {
    "use strict";

    /**
     * Reusable "View / Edit Field Assignment" helper.
     *
     * Lets the user open an already-assigned field from a Field Assignment
     * table, see its master-data info (description, data type, group) for
     * context, and edit the assignment-specific attributes (status, sequence,
     * default value, and — where applicable — read-only) without leaving the
     * page or losing track of which role/category/account group they're on.
     *
     * Each detail controller mixes these methods in and calls
     * this._openFieldAssignmentEdit(oConfig) where oConfig is:
     *   {
     *     collection   : "/BPRoleFields",          // junction collection
     *     fkName       : "role_role_id",            // FK column on the junction
     *     fkValue      : "FLVN01",                  // parent key value
     *     fieldId      : "BUKRS",                   // field_id of the row clicked
     *     updateGroupId: "bpRoleUpdate",             // batch group used by the detail
     *     showReadOnly : true,                       // only BPRoleField has read_only
     *     onDone       : function () { ... }          // reload callback after save
     *   }
     */
    return {

        _openFieldAssignmentEdit: function (oConfig) {
            this._fieldEditCfg = oConfig;

            var oFieldEdit = this.getView().getModel("fieldEdit");
            if (!oFieldEdit) {
                oFieldEdit = new JSONModel({ busy: false });
                this.getView().setModel(oFieldEdit, "fieldEdit");
            }

            var fnAfterLoad = function () {
                this._loadFieldAssignment().then(function () {
                    this._oFieldEditDialog.open();
                }.bind(this));
            }.bind(this);

            if (this._oFieldEditDialog) {
                fnAfterLoad();
                return;
            }

            Fragment.load({
                id        : this.getView().getId(),
                name      : "mdm.portal.view.fragment.FieldAssignmentEditDialog",
                controller: this
            }).then(function (oDialog) {
                this._oFieldEditDialog = oDialog;
                this.getView().addDependent(oDialog);
                fnAfterLoad();
            }.bind(this));
        },

        // Reads the current assignment row plus the field's master-data info
        // for display. The bound context created here is kept (this._oFieldEditCtx)
        // and reused on Save, the same read-then-patch pattern used elsewhere
        // in these detail controllers.
        _loadFieldAssignment: function () {
            var oCfg       = this._fieldEditCfg;
            var oModel     = this.getOwnerComponent().getModel();
            var oFieldEdit = this.getView().getModel("fieldEdit");

            oFieldEdit.setProperty("/busy", true);

            var sPath = oCfg.collection + "(" +
                oCfg.fkName + "='" + oCfg.fkValue + "'," +
                "field_field_id='" + oCfg.fieldId + "')";

            this._oFieldEditCtx = oModel.bindContext(sPath, null, {
                $$updateGroupId: oCfg.updateGroupId
            }).getBoundContext();

            var pAssignment = this._oFieldEditCtx.requestObject();
            var pFieldInfo  = oModel.bindContext("/FieldMasters('" + oCfg.fieldId + "')")
                .requestObject();

            return Promise.all([pAssignment, pFieldInfo]).then(function (aRes) {
                var oAssign = aRes[0] || {};
                var oField  = aRes[1] || {};
                var sMain   = oField.main_group_group_id || "";
                var sSub    = oField.sub_group_group_id  || "";
                oFieldEdit.setData({
                    field_id     : oCfg.fieldId,
                    description  : oField.description  || "",
                    data_type    : oField.data_type    || "\u2014",
                    display_type : oField.display_type || "\u2014",
                    group_path   : (sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "")) || "\u2014",
                    field_status : oAssign.field_status,
                    sequence     : oAssign.sequence,
                    default_value: oAssign.default_value || "",
                    read_only    : !!oAssign.read_only,
                    showReadOnly : !!oCfg.showReadOnly,
                    busy         : false
                });
            }).catch(function (e) {
                oFieldEdit.setProperty("/busy", false);
                MessageBox.error("Could not load field assignment: " + (e.message || "Unknown error"));
            });
        },

        onFieldAssignmentSave: function () {
            var oCfg   = this._fieldEditCfg;
            var oModel = this.getOwnerComponent().getModel();
            var oData  = this.getView().getModel("fieldEdit").getData();
            var oCtx   = this._oFieldEditCtx;

            if (!oData.field_status) {
                MessageBox.error("Field Status is required.");
                return;
            }
            var iSeq = parseInt(oData.sequence, 10);
            if (isNaN(iSeq)) {
                MessageBox.error("A valid Sequence number is required.");
                return;
            }

            oCtx.setProperty("field_status", oData.field_status);
            oCtx.setProperty("sequence", iSeq);
            oCtx.setProperty("default_value", oData.default_value || null);
            if (oCfg.showReadOnly) {
                oCtx.setProperty("read_only", !!oData.read_only);
            }

            oModel.submitBatch(oCfg.updateGroupId)
                .then(function () {
                    MessageToast.show("Field assignment saved.");
                    this._oFieldEditDialog.close();
                    if (typeof oCfg.onDone === "function") { oCfg.onDone(); }
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not save: " + (e.message || "Unknown error"));
                }.bind(this));
        },

        onFieldAssignmentCancel: function () {
            if (this._oFieldEditDialog) { this._oFieldEditDialog.close(); }
        }
    };
});
