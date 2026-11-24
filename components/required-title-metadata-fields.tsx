type RequiredTitleMetadataFieldsProps = {
  titleName: string;
  sortTitleName: string;
  releaseYearName: string;
  titleDefaultValue?: string;
  sortTitleDefaultValue?: string;
  releaseYearDefaultValue?: string;
};

export function RequiredTitleMetadataFields({
  titleName,
  sortTitleName,
  releaseYearName,
  titleDefaultValue,
  sortTitleDefaultValue,
  releaseYearDefaultValue,
}: RequiredTitleMetadataFieldsProps) {
  return (
    <>
      <label>
        Title
        <input
          type="text"
          name={titleName}
          defaultValue={titleDefaultValue}
          required
          maxLength={200}
        />
      </label>
      <label>
        Sort title
        <input
          type="text"
          name={sortTitleName}
          defaultValue={sortTitleDefaultValue}
          required
          maxLength={200}
        />
      </label>
      <label className="release-year-field">
        Release year
        <input
          type="number"
          name={releaseYearName}
          defaultValue={releaseYearDefaultValue}
          inputMode="numeric"
          min={1000}
          max={9999}
          step={1}
          required
        />
      </label>
    </>
  );
}
